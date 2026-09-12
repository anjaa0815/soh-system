const { EventEmitter } = require('events')

const { logger } = require('./logger')
const { toMeterReadingInput } = require('./normalizers/toMeterReading')

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

    async _handleReading (rawReading) {
        try {
            const input = toMeterReadingInput(rawReading)
            const [result] = await this.condoClient.registerMeterReadings([input])
            logger.info('registered reading', {
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
}

module.exports = { Bridge }
