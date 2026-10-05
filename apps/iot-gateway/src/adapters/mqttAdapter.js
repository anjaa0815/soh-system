const { EventEmitter } = require('events')

const mqtt = require('mqtt')

const { logger } = require('../logger')

/**
 * Subscribes to an MQTT broker and turns sensor payloads into 'reading' events.
 *
 * Expected topic shape: `meters/<meterNumber>/reading` (configurable via `topicPattern`,
 * using standard MQTT wildcards, e.g. `meters/+/reading` or `building/+/+/reading`).
 *
 * Expected JSON payload (a resident's own meter):
 *   { "address": "...", "unitName": "45", "accountNumber": "...",
 *     "resource": "coldWater", "value": 123.45, "timestamp": "2026-09-12T10:00:00Z" }
 *
 * Or, for a whole-building meter the HOA pays for (main entrance electricity riser,
 * common water supply, ...), set `"scope": "property"` and omit unitName/accountNumber:
 *   { "scope": "property", "address": "...", "resource": "electricity", "value": 88450 }
 *
 * `meterNumber` is taken from the topic's second segment unless the payload provides
 * its own `meterNumber` field (useful when one device reports for multiple meters).
 */
class MqttAdapter extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string} options.brokerUrl - e.g. mqtt://localhost:1883
     * @param {string} options.topicPattern - e.g. meters/+/reading
     * @param {import('mqtt').IClientOptions} [options.clientOptions]
     */
    constructor ({ brokerUrl, topicPattern, clientOptions = {} }) {
        super()
        this.brokerUrl = brokerUrl
        this.topicPattern = topicPattern
        this.clientOptions = clientOptions
        this.client = null
    }

    start () {
        this.client = mqtt.connect(this.brokerUrl, this.clientOptions)

        this.client.on('connect', () => {
            logger.info(`mqtt: connected to ${this.brokerUrl}`)
            this.client.subscribe(this.topicPattern, (err) => {
                if (err) {
                    this.emit('error', err)
                    return
                }
                logger.info(`mqtt: subscribed to "${this.topicPattern}"`)
            })
        })

        this.client.on('message', (topic, payloadBuffer) => {
            try {
                const reading = this._parseMessage(topic, payloadBuffer)
                this.emit('reading', reading)
            } catch (err) {
                this.emit('error', new Error(`mqtt: failed to parse message on "${topic}": ${err.message}`))
            }
        })

        this.client.on('error', (err) => this.emit('error', err))

        return this
    }

    stop () {
        if (this.client) this.client.end()
    }

    _parseMessage (topic, payloadBuffer) {
        const payload = JSON.parse(payloadBuffer.toString('utf8'))
        const topicMeterNumber = topic.split('/')[1]

        return {
            scope: payload.scope || 'unit',
            address: payload.address,
            unitType: payload.unitType,
            unitName: payload.unitName,
            accountNumber: payload.accountNumber,
            meterNumber: payload.meterNumber || topicMeterNumber,
            resource: payload.resource,
            value: payload.value,
            timestamp: payload.timestamp,
        }
    }
}

module.exports = { MqttAdapter }
