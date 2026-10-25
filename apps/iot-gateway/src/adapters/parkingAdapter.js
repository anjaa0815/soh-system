const { EventEmitter } = require('events')

const { logger } = require('../logger')
const { normalizePlate } = require('../parking/plates')

const pad = (n) => String(n).padStart(2, '0')
const toDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const toDateTime = (d) => `${toDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

function parseTime (value) {
    if (value === null || value === undefined || value === '') return null
    const date = (typeof value === 'number' || /^\d{10,13}$/.test(String(value)))
        ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
        : new Date(String(value).replace(' ', 'T'))
    return isNaN(date) ? null : date
}

/**
 * Adapter for the barrier/ALPR parking server ("yard"), speaking its third-party HTTP API
 * (`<baseUrl>/heartbeat`, `/monthRental`, `/monthCancel`, `/getCarIn`, `/getCarOut`, `/getCarPlace`).
 *
 * Emits:
 *  - 'vehicleEvent'  { direction: 'in'|'out', plate, time: Date, channel, raw }
 *  - 'occupancy'     { total, free, raw }
 *  - 'error'         Error
 *
 * That API has NO authentication and includes a gate-open command, so the parking server
 * must only be reachable on the compound's LAN. This adapter deliberately does not expose
 * `openGate`.
 *
 * Verified against a live parking server: every endpoint answers POST only (GET -> 405),
 * `/heartbeat` returns the parking number, `/getCarIn`//`getCarOut` return `{ status: 1, data: [] }`
 * and `/monthCancel` needs a JSON body. NOT yet verified with real vehicles: the exact
 * field formats inside entry/exit rows, and that `/monthRental` accepts the body built in
 * `issueMonthly` — run `npm run parking:check` against your server before relying on it.
 */
class ParkingAdapter extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string} options.baseUrl - e.g. http://192.168.1.50:9001/yard/third
     * @param {number} [options.monthlyCarType] - parking car type id for residents (21 = monthA)
     * @param {number} [options.pollIntervalMs]
     * @param {number} [options.timeoutMs]
     */
    constructor ({ baseUrl, monthlyCarType = 21, pollIntervalMs = 30000, timeoutMs = 8000 }) {
        super()
        if (!baseUrl) throw new Error('ParkingAdapter: "baseUrl" is required')
        this.baseUrl = baseUrl.replace(/\/$/, '')
        this.monthlyCarType = monthlyCarType
        this.pollIntervalMs = pollIntervalMs
        this.timeoutMs = timeoutMs
        this.parkingNo = ''
        this._timer = null
        this._lastPollAt = null
    }

    async _post (path, body) {
        const response = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: AbortSignal.timeout(this.timeoutMs),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.status !== 1) {
            throw new Error(`parking ${path}: ${response.status} ${payload.msg || 'unexpected response'}`)
        }
        return payload
    }

    async heartbeat () {
        const payload = await this._post('/heartbeat')
        this.parkingNo = payload.data || ''
        return this.parkingNo
    }

    /**
     * Register (or update) a resident's vehicle as a monthly car, free of charge at the gate.
     * @param {{ plate, name, phone, unitLabel, startDate, endDate }} registration
     */
    async issueMonthly (registration) {
        return this._post('/monthRental', {
            carNum: normalizePlate(registration.plate),
            name: registration.name || '',
            phone: registration.phone || '',
            department: registration.unitLabel || '',
            carType: this.monthlyCarType,
            startDate: registration.startDate,
            endDate: registration.endDate,
            chargeMoney: 0,
            payType: 0,
        })
    }

    async cancelMonthly (plate) {
        return this._post('/monthCancel', { carNum: normalizePlate(plate) })
    }

    async _records (path, direction, since, until) {
        const rows = []
        for (let pageNum = 1; pageNum <= 20; pageNum++) {
            const payload = await this._post(path, {
                parkingNo: this.parkingNo,
                startTime: toDateTime(since),
                endTime: toDateTime(until),
                pageNum,
                pageSize: 100,
            })
            const page = payload.data || payload.dataList || []
            rows.push(...page)
            if (page.length < 100) break
        }
        return rows.map((raw) => ({
            direction,
            plate: normalizePlate(raw.carNo),
            time: parseTime(direction === 'out' ? (raw.leaveTime || raw.time) : raw.time) || until,
            channel: (direction === 'out' ? raw.leavePass : raw.enterPass) || '',
            raw,
        })).filter((event) => event.plate)
    }

    getEntries (since, until = new Date()) { return this._records('/getCarIn', 'in', since, until) }

    getExits (since, until = new Date()) { return this._records('/getCarOut', 'out', since, until) }

    async getOccupancy () {
        const payload = await this._post('/getCarPlace')
        const data = payload.data || {}
        return { total: Number(data.totalPlace || 0), free: Number(data.emptyCar || 0), raw: data }
    }

    async pollOnce (now = new Date()) {
        // Overlap windows by a minute so nothing is lost between polls; the bridge de-duplicates.
        const since = new Date((this._lastPollAt || new Date(now.getTime() - this.pollIntervalMs)).getTime() - 60000)
        const events = [...await this.getEntries(since, now), ...await this.getExits(since, now)]
        events.sort((a, b) => a.time - b.time)
        for (const event of events) this.emit('vehicleEvent', event)
        this._lastPollAt = now
        return events.length
    }

    async start () {
        await this.heartbeat()
        logger.info('parking: connected', { baseUrl: this.baseUrl, parkingNo: this.parkingNo })
        this._timer = setInterval(() => {
            this.pollOnce().catch((err) => this.emit('error', err))
        }, this.pollIntervalMs)
        return this
    }

    stop () {
        clearInterval(this._timer)
        this._timer = null
    }
}

module.exports = { ParkingAdapter, toDate, toDateTime, parseTime }
