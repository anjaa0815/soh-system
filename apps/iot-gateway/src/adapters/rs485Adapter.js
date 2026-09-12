const { EventEmitter } = require('events')

const ModbusRTU = require('modbus-serial')

const { logger } = require('../logger')

/**
 * Polls Modbus RTU meters wired over an RS-485 bus and turns their register values
 * into 'reading' events. This is the common way water/heat/electricity meters expose
 * data on a shared industrial bus in a building's utility room.
 *
 * NEEDS REAL HARDWARE TO RUN: a USB-RS485 adapter (or equivalent serial port) wired
 * to the meters. This has not been exercised against real hardware in this scaffold —
 * verify register addresses and value scaling against your meter model's Modbus map
 * before relying on it.
 *
 * @typedef {Object} Rs485Device
 * @property {number} slaveId - Modbus slave/unit address of the device on the bus
 * @property {string} meterNumber
 * @property {string} resource - see normalizers/meterResources.js for valid values
 * @property {number} registerAddress - holding register to read the current value from
 * @property {string} [address] - property address (usually fixed per gateway instance/site)
 * @property {string} [unitName] - apartment/unit number this meter belongs to
 * @property {string} [accountNumber]
 */
class Rs485Adapter extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string} options.serialPort - e.g. /dev/ttyUSB0
     * @param {number} options.baudRate
     * @param {Rs485Device[]} options.devices
     * @param {number} options.pollIntervalMs
     */
    constructor ({ serialPort, baudRate, devices, pollIntervalMs }) {
        super()
        this.serialPort = serialPort
        this.baudRate = baudRate
        this.devices = devices
        this.pollIntervalMs = pollIntervalMs
        this.client = new ModbusRTU()
        this._timer = null
    }

    async start () {
        await this.client.connectRTUBuffered(this.serialPort, { baudRate: this.baudRate })
        logger.info(`rs485: connected to ${this.serialPort} @ ${this.baudRate} baud`)

        const poll = () => this._pollAll().catch((err) => this.emit('error', err))
        this._timer = setInterval(poll, this.pollIntervalMs)
        poll()

        return this
    }

    stop () {
        if (this._timer) clearInterval(this._timer)
        this.client.close(() => {})
    }

    async _pollAll () {
        for (const device of this.devices) {
            try {
                const reading = await this._pollDevice(device)
                this.emit('reading', reading)
            } catch (err) {
                this.emit('error', new Error(`rs485: failed to poll device ${device.meterNumber} (slave ${device.slaveId}): ${err.message}`))
            }
        }
    }

    async _pollDevice (device) {
        this.client.setID(device.slaveId)
        // Most utility meters expose a 32-bit value across 2 holding registers; adjust
        // the register count / decoding (readInputRegisters, byte order, scaling factor)
        // to match your specific meter's documented Modbus map.
        const { data } = await this.client.readHoldingRegisters(device.registerAddress, 2)
        const value = (data[0] << 16 | data[1]) / 1000 // example: raw units -> m3/kWh

        return {
            address: device.address,
            unitType: device.unitType,
            unitName: device.unitName,
            accountNumber: device.accountNumber,
            meterNumber: device.meterNumber,
            resource: device.resource,
            value,
            timestamp: new Date().toISOString(),
        }
    }
}

module.exports = { Rs485Adapter }
