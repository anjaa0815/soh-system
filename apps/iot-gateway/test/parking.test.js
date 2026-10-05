/**
 * Runs the parking pipeline against an in-process fake of the parking server's third-party
 * API and a fake of condo's GraphQL API — no hardware, no condo instance needed.
 *
 *   node --test test/
 */
const assert = require('node:assert')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test, before, after } = require('node:test')

const { ParkingAdapter } = require('../src/adapters/parkingAdapter')
const { Bridge } = require('../src/bridge')
const { CondoClient } = require('../src/condoClient')
const { createAdminServer } = require('../src/parking/adminServer')
const { ParkingSync } = require('../src/parking/parkingSync')
const { normalizePlate, parsePlatesValue } = require('../src/parking/plates')
const { StateStore } = require('../src/parking/stateStore')
const { planSync } = require('../src/parking/syncPlan')

const readJson = (req) => new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body ? JSON.parse(body) : {}))
})
const send = (res, payload, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

const yard = { monthly: new Map(), cancelled: [], carIn: [], carOut: [], failIssueFor: new Set() }
const condo = { customValues: [], contacts: [], writes: [] }
let yardServer, condoServer, yardUrl, condoUrl

before(async () => {
    yardServer = http.createServer(async (req, res) => {
        if (req.method !== 'POST') return send(res, { status: 0, msg: 'Unauthorized Access Interface' }, 405)
        const body = await readJson(req)
        const route = req.url.replace('/yard/third', '')
        if (route === '/heartbeat') return send(res, { status: 1, data: 'P00061847' })
        if (route === '/monthRental') {
            if (yard.failIssueFor.has(body.carNum)) return send(res, { status: 0, msg: 'busy' })
            yard.monthly.set(body.carNum, body)
            return send(res, { status: 1, msg: 'oper success' })
        }
        if (route === '/monthCancel') { yard.monthly.delete(body.carNum); yard.cancelled.push(body.carNum); return send(res, { status: 1 }) }
        if (route === '/getCarIn') return send(res, { status: 1, data: body.pageNum === 1 ? yard.carIn : [] })
        if (route === '/getCarOut') return send(res, { status: 1, data: body.pageNum === 1 ? yard.carOut : [] })
        if (route === '/getCarPlace') return send(res, { status: 1, data: { totalPlace: 120, emptyCar: 37 } })
        send(res, { status: 0 }, 404)
    })
    condoServer = http.createServer(async (req, res) => {
        const { query, variables } = await readJson(req)
        if (req.headers.authorization !== 'Bearer service-token') return send(res, { errors: [{ message: 'unauthorized' }] }, 401)
        if (query.includes('allCustomValues')) {
            const where = variables.where
            const items = condo.customValues.filter((value) => value.customField === where.customField.id
                && (!where.objectId || value.objectId === where.objectId)
                && (!where.objectId_in || where.objectId_in.includes(value.objectId)))
            return send(res, { data: { items: items.slice(variables.skip, variables.skip + variables.first) } })
        }
        if (query.includes('allContacts')) {
            const where = variables.where
            let items = condo.contacts.filter((contact) => !where.organization || (contact.organization || 'org-1') === where.organization.id)
            if (where.id_in) items = items.filter((contact) => where.id_in.includes(contact.id))
            if (where.id) items = items.filter((contact) => contact.id === where.id)
            if (where.OR) {
                const needle = where.OR[0].name_contains_i.toLowerCase()
                items = items.filter((contact) => [contact.name, contact.phone, contact.unitName].some((field) => String(field || '').toLowerCase().includes(needle)))
            }
            return send(res, { data: { items: items.slice(0, variables.first) } })
        }
        if (query.includes('createCustomValue')) {
            const value = { id: `cv-${condo.customValues.length + 1}`, customField: variables.data.customField.connect.id, objectId: variables.data.objectId, data: variables.data.data }
            condo.customValues.push(value); condo.writes.push({ op: 'create', ...variables.data })
            return send(res, { data: { result: { id: value.id } } })
        }
        if (query.includes('updateCustomValue')) {
            condo.customValues.find((value) => value.id === variables.id).data = variables.data.data
            condo.writes.push({ op: 'update', id: variables.id, ...variables.data })
            return send(res, { data: { result: { id: variables.id } } })
        }
        send(res, { errors: [{ message: 'unknown query' }] }, 400)
    })
    yardUrl = `http://127.0.0.1:${await listen(yardServer)}/yard/third`
    condoUrl = `http://127.0.0.1:${await listen(condoServer)}/admin/api`
})
after(() => { yardServer.close(); condoServer.close() })

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iot-gw-')), 'state.json')
const newPipeline = (stateFile = tmpFile()) => {
    const condoClient = new CondoClient({ apiUrl: condoUrl, serviceToken: 'service-token', organizationId: 'org-1' })
    const adapter = new ParkingAdapter({ baseUrl: yardUrl })
    const store = new StateStore(stateFile)
    const sync = new ParkingSync({ condoClient, adapter, store }, { platesCustomFieldId: 'field-plates' })
    return { condoClient, adapter, store, sync, stateFile }
}

test('plates are normalized and parsed from every supported CustomValue shape', () => {
    assert.strictEqual(normalizePlate(' 1234 уба '), '1234УБА')
    assert.strictEqual(normalizePlate('12-34 уна'), '1234УНА')
    assert.deepStrictEqual(parsePlatesValue('1234 уба, 5678УНА; 1234УБА'), [{ plate: '1234УБА', validUntil: null }, { plate: '5678УНА', validUntil: null }])
    assert.deepStrictEqual(parsePlatesValue(['1234уба']), [{ plate: '1234УБА', validUntil: null }])
    assert.deepStrictEqual(parsePlatesValue({ plates: [{ plate: '9999 ААА', validUntil: '2026-12-31T00:00:00Z' }] }), [{ plate: '9999ААА', validUntil: '2026-12-31' }])
    assert.deepStrictEqual(parsePlatesValue(null), [])
    assert.deepStrictEqual(parsePlatesValue(['ab']), [])
})

test('planSync issues new/changed plates and cancels only plates this gateway issued', () => {
    const a = { plate: 'A', name: 'x', phone: '1', unitLabel: 'u', startDate: 's', endDate: 'e' }
    const plan = planSync([a, { ...a, plate: 'B', name: 'changed' }], {
        A: { fingerprint: 'x|1|u|s|e' }, B: { fingerprint: 'x|1|u|s|e' }, GONE: { fingerprint: 'q' },
    })
    assert.deepStrictEqual(plan.toIssue.map((r) => r.plate), ['B'])
    assert.deepStrictEqual(plan.toCancel, ['GONE'])
    assert.strictEqual(plan.unchanged, 1)
})

test('sync registers resident plates as monthly cars, then removes them when they leave condo', async () => {
    condo.contacts = [
        { id: 'c-1', name: 'Бат', phone: '+97699112233', unitName: '45', unitType: 'flat', property: { id: 'p-1', address: 'Хан-Уул, 15-р хороо, 12-р байр' } },
        { id: 'c-2', name: 'Сараа', phone: '+97688001122', unitName: 'P-7', unitType: 'parking', property: { id: 'p-1', address: 'Хан-Уул, 15-р хороо, 12-р байр' } },
    ]
    condo.customValues = [
        { id: 'cv-a', customField: 'field-plates', objectId: 'c-1', data: '1234 уба, 5678УНА' },
        { id: 'cv-b', customField: 'field-plates', objectId: 'c-2', data: [{ plate: '7777УБМ', validUntil: '2020-01-01' }, { plate: '8888УБН', validUntil: '2099-12-31' }] },
        { id: 'cv-c', customField: 'field-plates', objectId: 'c-deleted', data: '0000ZZZ' },
        { id: 'cv-d', customField: 'another-field', objectId: 'c-1', data: '4444ААА' },
    ]
    const { sync, adapter, stateFile } = newPipeline()
    await adapter.heartbeat()
    assert.strictEqual(adapter.parkingNo, 'P00061847')

    const now = new Date(2026, 9, 5, 12, 0, 0)
    let summary = await sync.syncOnce(now)
    assert.deepStrictEqual(summary, { issued: 3, cancelled: 0, unchanged: 0, failed: 0 })
    assert.deepStrictEqual([...yard.monthly.keys()].sort(), ['1234УБА', '5678УНА', '8888УБН'])   // expired + deleted-contact plates skipped
    const sent = yard.monthly.get('1234УБА')
    assert.strictEqual(sent.name, 'Бат'); assert.strictEqual(sent.phone, '+97699112233'); assert.strictEqual(sent.carType, 21)
    assert.strictEqual(sent.startDate, '2026-10-05'); assert.strictEqual(sent.endDate, '2027-12-31'); assert.strictEqual(sent.chargeMoney, 0)
    assert.match(sent.department, /12-р байр, тоот 45/)
    assert.strictEqual(yard.monthly.get('8888УБН').endDate, '2099-12-31')
    assert.match(yard.monthly.get('8888УБН').department, /зогсоол P-7/)

    // a later run with nothing changed must not touch the parking system
    yard.monthly.clear()
    summary = await sync.syncOnce(new Date(2026, 9, 20))
    assert.deepStrictEqual(summary, { issued: 0, cancelled: 0, unchanged: 3, failed: 0 })
    assert.strictEqual(yard.monthly.size, 0)

    // state survives a restart
    const restarted = newPipeline(stateFile)
    summary = await restarted.sync.syncOnce(new Date(2026, 9, 21))
    assert.strictEqual(summary.unchanged, 3)

    // resident removes one plate, another contact changes phone
    condo.customValues[0].data = '1234 уба'
    condo.contacts[1].phone = '+97680000000'
    summary = await restarted.sync.syncOnce(new Date(2026, 9, 22))
    assert.deepStrictEqual(summary, { issued: 1, cancelled: 1, unchanged: 1, failed: 0 })
    assert.deepStrictEqual(yard.cancelled, ['5678УНА'])
    assert.strictEqual(yard.monthly.get('8888УБН').phone, '+97680000000')
    assert.strictEqual(yard.monthly.get('8888УБН').startDate, '2026-10-05')   // original start date kept
})

test('a failed issue is retried on the next sync instead of being recorded as done', async () => {
    condo.contacts = [{ id: 'c-9', name: 'Тест', phone: '1', unitName: '1', unitType: 'flat', property: null }]
    condo.customValues = [{ id: 'cv-z', customField: 'field-plates', objectId: 'c-9', data: '5555ТТТ' }]
    yard.monthly.clear(); yard.failIssueFor.add('5555ТТТ')
    const { sync } = newPipeline()
    assert.deepStrictEqual(await sync.syncOnce(), { issued: 0, cancelled: 0, unchanged: 0, failed: 1 })
    yard.failIssueFor.clear()
    assert.deepStrictEqual(await sync.syncOnce(), { issued: 1, cancelled: 0, unchanged: 0, failed: 0 })
    assert.ok(yard.monthly.has('5555ТТТ'))
})

test('entry/exit records become de-duplicated vehicle events attributed to the resident, with history written to condo', async () => {
    condo.contacts = [{ id: 'c-1', name: 'Бат', phone: '1', unitName: '45', unitType: 'flat', property: null }]
    condo.customValues = [{ id: 'cv-a', customField: 'field-plates', objectId: 'c-1', data: '1234УБА' }]
    condo.writes = []
    yard.carIn = [
        { carNo: '1234 уба', time: '2026-10-05 08:15:00', enterPass: 'Гарц 1 - орох' },
        { carNo: '9090ГОЧ', time: 1791200000000, enterPass: 'Гарц 1 - орох' },
    ]
    yard.carOut = [{ carNo: '1234УБА', time: '2026-10-05 08:15:00', leaveTime: '2026-10-05 18:40:00', leavePass: 'Гарц 1 - гарах' }]

    const { condoClient, adapter, store, sync } = newPipeline()
    await sync.syncOnce()
    const bridge = new Bridge(condoClient)
    const events = []
    bridge.on('vehicleEvent', (event) => events.push(event))
    bridge.useParkingAdapter(adapter, { sync, store, historyCustomFieldId: 'field-history', b2bAppId: 'app-1' })

    assert.strictEqual(await adapter.pollOnce(new Date(2026, 9, 5, 19, 0, 0)), 3)
    await adapter.pollOnce(new Date(2026, 9, 5, 19, 0, 30))   // same rows again -> ignored
    await new Promise((resolve) => setTimeout(resolve, 150))

    assert.strictEqual(events.length, 3)
    const resident = events.filter((event) => event.contact)
    assert.deepStrictEqual(resident.map((event) => [event.direction, event.plate, event.channel]), [['in', '1234УБА', 'Гарц 1 - орох'], ['out', '1234УБА', 'Гарц 1 - гарах']])
    assert.strictEqual(events.find((event) => event.plate === '9090ГОЧ').contact, null)

    const history = condo.customValues.find((value) => value.customField === 'field-history')
    assert.strictEqual(history.objectId, 'c-1')
    assert.strictEqual(history.data.length, 2)
    assert.strictEqual(history.data[0].direction, 'out')   // newest first
    assert.ok(condo.writes.every((write) => write.sourceType === 'B2BApp' && write.sourceId === 'app-1'))
    assert.strictEqual(condo.writes.filter((write) => write.op === 'create').length, 1)   // second event updates, not duplicates
})

test('occupancy is read from the parking server', async () => {
    const { adapter } = newPipeline()
    assert.deepStrictEqual(await adapter.getOccupancy(), { total: 120, free: 37, raw: { totalPlace: 120, emptyCar: 37 } })
})

test('the adapter does not expose a gate-open command', () => {
    const { adapter } = newPipeline()
    assert.strictEqual(typeof adapter.openGate, 'undefined')
})

test('plate editor: PIN is enforced, plates are validated, saved to condo and pushed to the parking server', async () => {
    const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'aaaaaaaa-0000-4000-8000-000000000002', OTHER = 'aaaaaaaa-0000-4000-8000-000000000003'
    condo.contacts = [
        { id: A, name: 'Бат-Эрдэнэ', phone: '+97699112233', unitName: '45', unitType: 'flat', property: { id: 'p-1', address: '12-р байр' } },
        { id: B, name: 'Сарантуяа', phone: '+97688001122', unitName: '46', unitType: 'flat', property: { id: 'p-1', address: '12-р байр' } },
        { id: OTHER, name: 'Өөр байгууллагын хүн', phone: '+97611111111', unitName: '1', unitType: 'flat', property: null, organization: 'org-2' },
    ]
    condo.customValues = [{ id: 'cv-b', customField: 'field-plates', objectId: B, data: [{ plate: '5678УНА' }] }]
    condo.writes = []; yard.monthly.clear(); yard.cancelled = []

    const { condoClient, adapter, sync } = newPipeline()
    await adapter.heartbeat(); await sync.syncOnce()
    assert.throws(() => createAdminServer({ condoClient, sync, adapter, platesCustomFieldId: 'field-plates', b2bAppId: 'app-1', pin: '' }), /PIN/)
    const server = createAdminServer({ condoClient, sync, adapter, platesCustomFieldId: 'field-plates', b2bAppId: 'app-1', pin: '4821' })
    const port = await listen(server)
    const call = async (method, url, body, pinValue = '4821') => {
        const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Pin': pinValue }, body: body ? JSON.stringify(body) : undefined })
        return { status: res.status, data: await res.json().catch(() => null) }
    }
    try {
        const page = await fetch(`http://127.0.0.1:${port}/`)
        assert.strictEqual(page.status, 200); assert.match(await page.text(), /Машины дугаарын бүртгэл/)

        assert.strictEqual((await call('GET', '/api/status', null, 'wrong')).status, 401)
        assert.strictEqual((await call('GET', '/api/contacts?q=бат', null, '')).status, 401)
        assert.strictEqual((await call('PUT', `/api/contacts/${A}/plates`, { plates: [{ plate: '1111ААА' }] }, '0000')).status, 401)
        assert.strictEqual(condo.writes.length, 0)

        const status = await call('GET', '/api/status')
        assert.deepStrictEqual(status.data.parking, { ok: true, parkingNo: 'P00061847', free: 37, total: 120 })
        assert.strictEqual(status.data.issued, 1)

        let found = await call('GET', '/api/contacts?q=' + encodeURIComponent('бат'))
        assert.deepStrictEqual(found.data.contacts.map((c) => [c.name, c.plates.length]), [['Бат-Эрдэнэ', 0]])
        found = await call('GET', '/api/contacts?q=46')
        assert.deepStrictEqual(found.data.contacts[0].plates, [{ plate: '5678УНА', validUntil: null }])
        assert.deepStrictEqual((await call('GET', '/api/contacts?q=' + encodeURIComponent('Өөр'))).data.contacts, [])   // other organization is invisible

        for (const bad of [{ plates: 'x' }, { plates: [{ plate: 'ab' }] }, { plates: [{ plate: '1234<script>' }] }, { plates: [{ plate: '1234УБА', validUntil: 'soon' }] }, { plates: Array.from({ length: 11 }, (_, i) => ({ plate: `10${String(i).padStart(2, '0')}УБА` })) }]) {
            assert.strictEqual((await call('PUT', `/api/contacts/${A}/plates`, bad)).status, 400)
        }
        assert.strictEqual((await call('PUT', `/api/contacts/${OTHER}/plates`, { plates: [{ plate: '1234УБА' }] })).status, 404)
        const clash = await call('PUT', `/api/contacts/${A}/plates`, { plates: [{ plate: '5678 уна' }] })
        assert.strictEqual(clash.status, 409); assert.match(clash.data.error, /Сарантуяа/)
        assert.strictEqual(condo.writes.length, 0)

        const saved = await call('PUT', `/api/contacts/${A}/plates`, { plates: [{ plate: '1234 уба' }, { plate: '1234УБА' }, { plate: '9999УБЕ', validUntil: '2099-06-30' }] })
        assert.strictEqual(saved.status, 200)
        assert.deepStrictEqual(saved.data.plates, [{ plate: '1234УБА' }, { plate: '9999УБЕ', validUntil: '2099-06-30' }])
        assert.strictEqual(saved.data.sync.issued, 2)
        assert.ok(yard.monthly.has('1234УБА')); assert.strictEqual(yard.monthly.get('9999УБЕ').endDate, '2099-06-30'); assert.strictEqual(yard.monthly.get('1234УБА').name, 'Бат-Эрдэнэ')

        const removed = await call('PUT', `/api/contacts/${A}/plates`, { plates: [{ plate: '9999УБЕ', validUntil: '2099-06-30' }] })
        assert.strictEqual(removed.data.sync.cancelled, 1); assert.deepStrictEqual(yard.cancelled, ['1234УБА']); assert.ok(!yard.monthly.has('1234УБА'))
        assert.ok(yard.monthly.has('5678УНА'))   // the other resident is untouched

        for (let i = 0; i < 10; i++) await call('GET', '/api/status', null, 'guess' + i)
        assert.strictEqual((await call('GET', '/api/status')).status, 429)   // locked out even with the right PIN
    } finally {
        server.close()
    }
})
