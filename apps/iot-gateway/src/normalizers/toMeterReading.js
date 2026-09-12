const { resolveMeterResourceId } = require('./meterResources')

/**
 * A protocol-agnostic reading shape every adapter (MQTT, RS-485, ...) normalizes into
 * before it reaches the bridge. Keeping this shape narrow is what lets adapters stay
 * independent of condo's GraphQL input format.
 *
 * @typedef {Object} RawReading
 * @property {string} address - property address as known to condo
 * @property {string} [unitType] - e.g. 'flat', 'parking' — defaults to 'flat'
 * @property {string} unitName - apartment/unit number
 * @property {string} accountNumber - resident's billing account number
 * @property {string} meterNumber - physical meter serial number
 * @property {'coldWater'|'hotWater'|'electricity'|'heatSupply'|'gasSupply'|'coldAir'|'drainage'} resource
 * @property {number|string} value - current meter value (tariff 1)
 * @property {Date|string} [timestamp] - when the reading was taken, defaults to now
 */

/**
 * Converts a RawReading into condo's `RegisterMetersReadingsReadingInput` shape.
 * @param {RawReading} reading
 */
function toMeterReadingInput (reading) {
    const {
        address,
        unitType = 'flat',
        unitName,
        accountNumber,
        meterNumber,
        resource,
        value,
        timestamp,
    } = reading

    if (!address) throw new Error('toMeterReadingInput: "address" is required')
    if (!unitName) throw new Error('toMeterReadingInput: "unitName" is required')
    if (!accountNumber) throw new Error('toMeterReadingInput: "accountNumber" is required')
    if (!meterNumber) throw new Error('toMeterReadingInput: "meterNumber" is required')
    if (value === undefined || value === null) throw new Error('toMeterReadingInput: "value" is required')

    const date = timestamp ? new Date(timestamp) : new Date()

    return {
        address,
        addressInfo: { unitType, unitName },
        accountNumber,
        meterNumber,
        meterResource: { id: resolveMeterResourceId(resource) },
        date: date.toISOString(),
        value1: String(value),
    }
}

module.exports = { toMeterReadingInput }
