const { resolveMeterResourceId } = require('./meterResources')

/**
 * A protocol-agnostic reading shape every adapter (MQTT, RS-485, ...) normalizes into
 * before it reaches the bridge. Keeping this shape narrow is what lets adapters stay
 * independent of condo's GraphQL input format.
 *
 * Set `scope: 'unit'` (the default) for a resident's own meter — the one condo bills
 * to their account (`unitName`/`accountNumber` required). Set `scope: 'property'` for
 * a meter that belongs to the whole building — the entrance hallway light, the
 * elevator, the common water riser — the kind of meter the HOA itself pays for, not
 * any one resident. These map to two different condo mutations
 * (`registerMetersReadings` vs `registerPropertyMetersReadings`) because condo models
 * them as genuinely different things: a unit meter is tied to a billing account, a
 * property meter is only ever tied to the building.
 *
 * @typedef {Object} RawReading
 * @property {'unit'|'property'} [scope] - defaults to 'unit'
 * @property {string} address - property address as known to condo
 * @property {string} [unitType] - e.g. 'flat', 'parking' — defaults to 'flat'. Ignored for scope 'property'.
 * @property {string} [unitName] - apartment/unit number. Required for scope 'unit'.
 * @property {string} [accountNumber] - resident's billing account number. Required for scope 'unit'.
 * @property {string} meterNumber - physical meter serial number
 * @property {'coldWater'|'hotWater'|'electricity'|'heatSupply'|'gasSupply'|'coldAir'|'drainage'} resource
 * @property {number|string} value - current meter value (tariff 1)
 * @property {Date|string} [timestamp] - when the reading was taken, defaults to now
 */

/**
 * Converts a RawReading into condo's `RegisterMetersReadingsReadingInput` shape
 * (a resident's own, billed-to-their-account meter).
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

    return {
        address,
        addressInfo: { unitType, unitName },
        accountNumber,
        meterNumber,
        meterResource: { id: resolveMeterResourceId(resource) },
        date: toISODate(timestamp),
        value1: String(value),
    }
}

/**
 * Converts a RawReading into condo's `RegisterPropertyMetersReadingsReadingInput`
 * shape (a whole-building meter — common-area electricity/water the HOA pays for,
 * not any one resident's account).
 * @param {RawReading} reading
 */
function toPropertyMeterReadingInput (reading) {
    const { address, meterNumber, resource, value, timestamp } = reading

    if (!address) throw new Error('toPropertyMeterReadingInput: "address" is required')
    if (!meterNumber) throw new Error('toPropertyMeterReadingInput: "meterNumber" is required')
    if (value === undefined || value === null) throw new Error('toPropertyMeterReadingInput: "value" is required')

    return {
        address,
        meterNumber,
        meterResource: { id: resolveMeterResourceId(resource) },
        date: toISODate(timestamp),
        value1: String(value),
    }
}

function toISODate (timestamp) {
    return (timestamp ? new Date(timestamp) : new Date()).toISOString()
}

module.exports = { toMeterReadingInput, toPropertyMeterReadingInput }
