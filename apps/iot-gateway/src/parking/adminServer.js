const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const { logger } = require('../logger')

const { normalizePlate, parsePlatesValue } = require('./plates')

const PAGE = path.resolve(__dirname, '..', '..', 'public', 'plates.html')
const MAX_PLATES_PER_CONTACT = 10
const MAX_FAILED_PINS = 10
const LOCK_MS = 5 * 60 * 1000

class HttpError extends Error {
    constructor (status, message) { super(message); this.status = status }
}

/**
 * Small LAN-only screen for the security desk / HOA office to edit which plates belong
 * to which resident. condo's own UI cannot do this today: CustomValues may only be
 * written by a B2BApp service user, which is exactly what this gateway is.
 *
 * Every request needs the PIN; there is deliberately no way to start it without one.
 */
function createAdminServer ({ condoClient, sync, adapter, platesCustomFieldId, b2bAppId, pin }) {
    if (!pin || String(pin).length < 4) throw new Error('parking admin: PARKING_ADMIN_PIN (4+ characters) is required')
    const pinHash = crypto.createHash('sha256').update(String(pin)).digest()
    const failures = new Map()   // ip -> { count, until }
    let lastSync = null

    function checkPin (req) {
        const ip = req.socket.remoteAddress
        const entry = failures.get(ip) || { count: 0, until: 0 }
        if (entry.until > Date.now()) throw new HttpError(429, 'Олон удаа буруу PIN оруулсан. 5 минутын дараа дахин оролдоно уу')
        const given = crypto.createHash('sha256').update(String(req.headers['x-pin'] || '')).digest()
        if (!crypto.timingSafeEqual(given, pinHash)) {
            entry.count++
            if (entry.count >= MAX_FAILED_PINS) { entry.until = Date.now() + LOCK_MS; entry.count = 0 }
            failures.set(ip, entry)
            throw new HttpError(401, 'PIN буруу байна')
        }
        failures.delete(ip)
    }

    function validatePlates (input) {
        if (!Array.isArray(input)) throw new HttpError(400, 'Дугаарын жагсаалт буруу байна')
        if (input.length > MAX_PLATES_PER_CONTACT) throw new HttpError(400, `Нэг оршин суугчид хамгийн ихдээ ${MAX_PLATES_PER_CONTACT} дугаар бүртгэнэ`)
        const result = []
        const seen = new Set()
        for (const item of input) {
            const plate = normalizePlate(item && item.plate)
            if (!/^[0-9A-ZА-ЯӨҮЁ]{4,10}$/.test(plate)) throw new HttpError(400, `"${(item && item.plate) || ''}" дугаар буруу байна`)
            if (seen.has(plate)) continue
            seen.add(plate)
            const validUntil = item.validUntil ? String(item.validUntil).slice(0, 10) : null
            if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new HttpError(400, `${plate}: дуусах огноо буруу байна`)
            result.push(validUntil ? { plate, validUntil } : { plate })
        }
        return result
    }

    const routes = {
        'GET /api/status': async () => {
            let parking
            try {
                const occupancy = await adapter.getOccupancy()
                parking = { ok: true, parkingNo: adapter.parkingNo || await adapter.heartbeat(), free: occupancy.free, total: occupancy.total }
            } catch (err) {
                parking = { ok: false, error: err.message }
            }
            return { parking, issued: Object.keys(sync.store.issued).length, lastSync }
        },
        'GET /api/contacts': async (req, url) => {
            const query = (url.searchParams.get('q') || '').trim()
            if (query.length < 2) return { contacts: [] }
            const contacts = await condoClient.searchContacts(query)
            const values = await condoClient.getPlatesForContacts(platesCustomFieldId, contacts.map((contact) => contact.id))
            return { contacts: contacts.map((contact) => ({ ...contact, plates: parsePlatesValue(values.get(contact.id)) })) }
        },
        'PUT /api/contacts/': async (req, url, contactId, body) => {
            const plates = validatePlates(body.plates)
            const contact = await condoClient.getContact(contactId)
            if (!contact) throw new HttpError(404, 'Оршин суугч олдсонгүй')

            // A plate may belong to one contact only — otherwise removing it from one
            // resident would silently leave the barrier open through the other.
            const taken = (await condoClient.getVehicleRegistrations(platesCustomFieldId))
                .filter((vehicle) => vehicle.contact.id !== contactId)
            for (const { plate } of plates) {
                const other = taken.find((vehicle) => vehicle.plate === plate)
                if (other) throw new HttpError(409, `${plate} дугаар ${other.contact.name || 'өөр оршин суугч'} (${other.contact.unitName || '-'}) дээр бүртгэлтэй байна`)
            }

            await condoClient.upsertCustomValue({ customFieldId: platesCustomFieldId, objectId: contactId, data: plates, b2bAppId })
            logger.info('parking admin: plates updated', { contact: contactId, plates: plates.map((item) => item.plate) })
            try {
                lastSync = { at: new Date().toISOString(), ...(await sync.syncOnce()) }
            } catch (err) {
                lastSync = { at: new Date().toISOString(), error: err.message }
            }
            return { plates, sync: lastSync }
        },
        'POST /api/sync': async () => {
            lastSync = { at: new Date().toISOString(), ...(await sync.syncOnce()) }
            return { sync: lastSync }
        },
    }

    const send = (res, status, payload, type = 'application/json; charset=utf-8') => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload))
    }
    const readBody = (req) => new Promise((resolve, reject) => {
        let raw = ''
        req.on('data', (chunk) => { raw += chunk; if (raw.length > 20000) { reject(new HttpError(413, 'Хүсэлт хэт том байна')); req.destroy() } })
        req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (err) { reject(new HttpError(400, 'JSON буруу байна')) } })
    })

    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://gateway')
        try {
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/plates')) {
                return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8')
            }
            if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Олдсонгүй')
            checkPin(req)

            const match = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]{8,64})\/plates$/i)
            const key = match ? `${req.method} /api/contacts/` : `${req.method} ${url.pathname}`
            const handler = routes[key]
            if (!handler) throw new HttpError(404, 'Олдсонгүй')
            const body = ['PUT', 'POST'].includes(req.method) ? await readBody(req) : {}
            send(res, 200, await handler(req, url, match && match[1], body))
        } catch (err) {
            const status = err.status || 502
            if (!err.status) logger.error('parking admin: request failed', req.method, url.pathname, err.message)
            send(res, status, { error: err.status ? err.message : 'Платформ эсвэл зогсоолын системтэй холбогдоход алдаа гарлаа: ' + err.message })
        }
    })
}

module.exports = { createAdminServer }
