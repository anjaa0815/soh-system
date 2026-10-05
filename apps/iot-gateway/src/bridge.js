const { EventEmitter } = require('events')

const { logger } = require('./logger')
const { toMeterReadingInput, toPropertyMeterReadingInput } = require('./normalizers/toMeterReading')

/**
 * Wires protocol adapters (MQTT/ONVIF/RS-485 — anything that emits normalized events)
 * to condo's GraphQL API. Adapters know nothing about condo; the bridge is the only
 * piece that translates domain events into API calls.
 */
class Bridge extends EventEmitter {
    /**
     * @param {import('./condoClient').CondoClient} condoClient
     */
    constructor (condoClient) {
        super()
        this.condoClient = condoClient
    }

    /**
     * Attach an adapter that emits 'reading' events with a RawReading payload
     * (see normalizers/toMeterReading.js for the shape).
     */
    useMeterAdapter (adapter) {
        adapter.on('reading', (rawReading) => this._handleReading(rawReading))
        adapter.on('error', (err) => logger.error('adapter error:', err.message))
        return this
    }

    /**
     * Attach an adapter that emits 'motionEvent' events (currently only OnvifAdapter).
     * There is no generic condo mutation for "a camera saw something" — what to do next
     * (open a ticket, page someone, just log it) is organization-specific, so the caller
     * supplies `onMotionEvent` rather than this bridge assuming a fixed action.
     * @param {import('events').EventEmitter} adapter
     * @param {(event: object) => Promise<void>|void} onMotionEvent
     */
    useCameraAdapter (adapter, onMotionEvent) {
        adapter.on('motionEvent', (event) => {
            logger.info('camera motion event', { camera: event.camera, topic: event.topic })
            Promise.resolve(onMotionEvent(event)).catch((err) =>
                logger.error('onMotionEvent handler failed', err.message))
        })
        adapter.on('error', (err) => logger.error('adapter error:', err.message))
        return this
    }

    /**
     * Attach the parking adapter. Entry/exit events are de-duplicated, attributed to the
     * condo Contact that owns the plate (when it is a resident's), and — if a history
     * CustomField is configured — appended to that contact's parking history in condo.
     * @param {import('./adapters/parkingAdapter').ParkingAdapter} adapter
     * @param {Object} options
     * @param {import('./parking/parkingSync').ParkingSync} options.sync
     * @param {import('./parking/stateStore').StateStore} options.store
     * @param {string} [options.historyCustomFieldId]
     * @param {string} [options.b2bAppId]
     * @param {number} [options.historySize]
     */
    useParkingAdapter (adapter, { sync, store, historyCustomFieldId, b2bAppId, historySize = 20 }) {
        const histories = new Map()
        const writeQueues = new Map()
        adapter.on('vehicleEvent', (event) => {
            const key = `${event.direction}|${event.plate}|${event.time.getTime()}`
            if (!store.markEventSeen(key)) return
            store.save()

            const contact = sync.ownerOf(event.plate)
            logger.info('parking: vehicle event', {
                direction: event.direction, plate: event.plate, channel: event.channel, resident: Boolean(contact),
            })
            this.emit('vehicleEvent', { ...event, contact })
            if (!contact || !historyCustomFieldId) return

            const history = histories.get(contact.id) || []
            history.unshift({ direction: event.direction, plate: event.plate, time: event.time.toISOString(), channel: event.channel })
            histories.set(contact.id, history.slice(0, historySize))
            // Writes for one contact are chained: two events arriving together would otherwise
            // both find "no value yet" and create two CustomValues instead of one.
            const snapshot = histories.get(contact.id)
            const previous = writeQueues.get(contact.id) || Promise.resolve()
            writeQueues.set(contact.id, previous.then(() => this.condoClient.upsertCustomValue({
                customFieldId: historyCustomFieldId, objectId: contact.id, data: snapshot, b2bAppId,
            })).catch((err) => logger.error('parking: failed to store history in condo', event.plate, err.message)))
        })
        adapter.on('occupancy', (occupancy) => this.emit('occupancy', occupancy))
        adapter.on('error', (err) => logger.error('adapter error:', err.message))
        return this
    }

    async _handleReading (rawReading) {
        const isPropertyMeter = rawReading.scope === 'property'
        try {
            const result = isPropertyMeter
                ? (await this._registerPropertyReading(rawReading))
                : (await this._registerUnitReading(rawReading))
            logger.info('registered reading', {
                scope: isPropertyMeter ? 'property' : 'unit',
                meterNumber: rawReading.meterNumber,
                resource: rawReading.resource,
                value: rawReading.value,
                meterId: result && result.meter && result.meter.id,
            })
            this.emit('registered', { rawReading, result })
        } catch (err) {
            logger.error('failed to register reading', rawReading, err.message)
            this.emit('registerError', { rawReading, error: err })
        }
    }

    async _registerUnitReading (rawReading) {
        const input = toMeterReadingInput(rawReading)
        const [result] = await this.condoClient.registerMeterReadings([input])
        return result
    }

    async _registerPropertyReading (rawReading) {
        const input = toPropertyMeterReadingInput(rawReading)
        const [result] = await this.condoClient.registerPropertyMeterReadings([input])
        return result
    }
}

module.exports = { Bridge }
