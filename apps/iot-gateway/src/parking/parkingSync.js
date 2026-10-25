const { logger } = require('../logger')
const { toDate } = require('../adapters/parkingAdapter')

const { planSync, fingerprint } = require('./syncPlan')

const UNIT_TYPE_LABELS = { flat: 'тоот', parking: 'зогсоол', apartment: 'апартмент', warehouse: 'агуулах', commercial: 'үйлчилгээ' }

/**
 * Keeps the parking system's monthly-car list equal to the plates recorded on condo
 * Contacts: a plate added to a resident's contact opens the barrier for them, a plate
 * removed (or a contact deleted) stops doing so on the next sync.
 */
class ParkingSync {
    /**
     * @param {Object} deps
     * @param {import('../condoClient').CondoClient} deps.condoClient
     * @param {import('../adapters/parkingAdapter').ParkingAdapter} deps.adapter
     * @param {import('./stateStore').StateStore} deps.store
     * @param {Object} options
     * @param {string} options.platesCustomFieldId
     * @param {number} [options.defaultValidDays] - validity window for plates without an explicit validUntil
     */
    constructor ({ condoClient, adapter, store }, { platesCustomFieldId, defaultValidDays = 365 }) {
        if (!platesCustomFieldId) throw new Error('ParkingSync: "platesCustomFieldId" is required')
        this.condoClient = condoClient
        this.adapter = adapter
        this.store = store
        this.platesCustomFieldId = platesCustomFieldId
        this.defaultValidDays = defaultValidDays
        this.plateOwners = new Map()
        this._running = false
    }

    _toRegistrations (vehicles, now) {
        const startDate = toDate(now)
        const today = startDate
        // Plates without an explicit expiry are valid to the end of the year that lies
        // `defaultValidDays` ahead. Anchoring on a year end keeps the fingerprint stable,
        // so an unchanged plate is re-issued once a year rather than on every sync.
        const horizon = new Date(now.getTime() + this.defaultValidDays * 86400000)
        const defaultEndDate = `${horizon.getFullYear()}-12-31`

        const registrations = []
        const owners = new Map()
        for (const vehicle of vehicles) {
            const endDate = vehicle.validUntil || defaultEndDate
            if (endDate < today) continue   // expired -> not desired -> gets cancelled
            if (owners.has(vehicle.plate)) {
                logger.warn('parking: plate is recorded on more than one contact, keeping the first', vehicle.plate)
                continue
            }
            owners.set(vehicle.plate, vehicle.contact)
            const contact = vehicle.contact
            const unitLabel = [contact.propertyAddress, contact.unitName && `${UNIT_TYPE_LABELS[contact.unitType] || ''} ${contact.unitName}`.trim()]
                .filter(Boolean).join(', ').slice(0, 60)
            const existing = this.store.issued[vehicle.plate]
            registrations.push({
                plate: vehicle.plate,
                name: contact.name || '',
                phone: contact.phone || '',
                unitLabel,
                // keep the original start date so an unchanged plate is not re-issued daily
                startDate: (existing && existing.startDate) || startDate,
                endDate,
            })
        }
        this.plateOwners = owners
        return registrations
    }

    /** @returns {Promise<{issued: number, cancelled: number, unchanged: number, failed: number}>} */
    async syncOnce (now = new Date()) {
        if (this._running) return { issued: 0, cancelled: 0, unchanged: 0, failed: 0, skipped: true }
        this._running = true
        const summary = { issued: 0, cancelled: 0, unchanged: 0, failed: 0 }
        try {
            const vehicles = await this.condoClient.getVehicleRegistrations(this.platesCustomFieldId)
            const plan = planSync(this._toRegistrations(vehicles, now), this.store.issued)
            summary.unchanged = plan.unchanged

            for (const registration of plan.toIssue) {
                try {
                    await this.adapter.issueMonthly(registration)
                    this.store.setIssued(registration.plate, { fingerprint: fingerprint(registration), startDate: registration.startDate })
                    summary.issued++
                } catch (err) {
                    summary.failed++
                    logger.error('parking: failed to issue plate', registration.plate, err.message)
                }
            }
            for (const plate of plan.toCancel) {
                try {
                    await this.adapter.cancelMonthly(plate)
                    this.store.removeIssued(plate)
                    summary.cancelled++
                } catch (err) {
                    summary.failed++
                    logger.error('parking: failed to cancel plate', plate, err.message)
                }
            }
            this.store.save()
            if (summary.issued || summary.cancelled || summary.failed) logger.info('parking: sync done', summary)
            return summary
        } finally {
            this._running = false
        }
    }

    /** Contact that owns a plate, as of the last sync (used to attribute entry/exit events). */
    ownerOf (plate) { return this.plateOwners.get(plate) || null }
}

module.exports = { ParkingSync }
