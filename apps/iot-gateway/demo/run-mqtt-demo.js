/**
 * End-to-end demo of the MQTT -> condo pipeline, with no real hardware required:
 *
 *   fake sensor (mqtt.publish) -> in-process Aedes broker -> MqttAdapter -> Bridge
 *     -> CondoClient.registerMeterReadings -> live condo GraphQL API -> Postgres
 *
 * This authenticates with a regular staff phone+password login (via
 * authenticateUserWithPhoneAndPassword) rather than a B2BAccessToken, purely because
 * that's much faster to set up for a demo — it returns the same kind of bearer token
 * a B2BAccessToken does, so CondoClient itself doesn't need any demo-specific code.
 * A real deployment should mint a proper B2BApp service-user token instead of reusing
 * a staff login (see README.md "From demo to production").
 *
 * Usage: node demo/run-mqtt-demo.js
 * Requires env vars (see below) — copy .env.example to .env.demo or export them inline.
 */
const path = require('path')

const { Aedes } = require('aedes')
const mqtt = require('mqtt')
const net = require('net')

const { Bridge } = require('../src/bridge')
const { CondoClient } = require('../src/condoClient')
const { logger } = require('../src/logger')
const { MqttAdapter } = require('../src/adapters/mqttAdapter')

require('dotenv').config({ path: path.resolve(__dirname, '.env.demo') })

const CONDO_API_URL = process.env.CONDO_API_URL || 'http://localhost:4002/admin/api'
const DEMO_PHONE = process.env.DEMO_PHONE
const DEMO_PASSWORD = process.env.DEMO_PASSWORD
const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID
const DEMO_ADDRESS = process.env.DEMO_ADDRESS
const BROKER_PORT = 18830

async function authenticate () {
    const res = await fetch(CONDO_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: `mutation($data: AuthenticateUserWithPhoneAndPasswordInput!) {
                result: authenticateUserWithPhoneAndPassword(data: $data) { token item { id name } }
            }`,
            variables: {
                data: { dv: 1, sender: { dv: 1, fingerprint: 'iot-gateway-demo' }, phone: DEMO_PHONE, password: DEMO_PASSWORD },
            },
        }),
    })
    const { data, errors } = await res.json()
    if (errors) throw new Error(`authentication failed: ${JSON.stringify(errors)}`)
    logger.info(`authenticated as "${data.result.item.name}"`)
    return data.result.token
}

async function startLocalBroker (port) {
    const broker = await Aedes.createBroker()
    const server = net.createServer(broker.handle)
    return new Promise((resolve) => {
        server.listen(port, () => {
            logger.info(`demo: in-process MQTT broker listening on :${port}`)
            resolve(server)
        })
    })
}

function publishFakeReadings (brokerUrl) {
    const publisher = mqtt.connect(brokerUrl)
    const readings = [
        { meterNumber: 'COLD-45-01', resource: 'coldWater', value: 128.4 },
        { meterNumber: 'HOT-45-01', resource: 'hotWater', value: 87.1 },
        { meterNumber: 'ELEC-45-01', resource: 'electricity', value: 5421 },
    ]

    publisher.on('connect', () => {
        for (const reading of readings) {
            const payload = {
                address: DEMO_ADDRESS,
                unitType: 'flat',
                unitName: '45',
                accountNumber: 'ACC-45',
                resource: reading.resource,
                value: reading.value,
                timestamp: new Date().toISOString(),
            }
            const topic = `meters/${reading.meterNumber}/reading`
            publisher.publish(topic, JSON.stringify(payload))
            logger.info(`demo: published fake sensor reading to "${topic}"`, payload)
        }
        setTimeout(() => publisher.end(), 2000)
    })
}

async function main () {
    if (!DEMO_PHONE || !DEMO_PASSWORD || !DEMO_ORGANIZATION_ID || !DEMO_ADDRESS) {
        throw new Error('Set DEMO_PHONE, DEMO_PASSWORD, DEMO_ORGANIZATION_ID, DEMO_ADDRESS in demo/.env.demo')
    }

    const brokerServer = await startLocalBroker(BROKER_PORT)
    const brokerUrl = `mqtt://localhost:${BROKER_PORT}`

    const token = await authenticate()
    const condoClient = new CondoClient({
        apiUrl: CONDO_API_URL,
        serviceToken: token,
        organizationId: DEMO_ORGANIZATION_ID,
    })
    const bridge = new Bridge(condoClient)

    const mqttAdapter = new MqttAdapter({ brokerUrl, topicPattern: 'meters/+/reading' }).start()
    bridge.useMeterAdapter(mqttAdapter)

    let registeredCount = 0
    bridge.on('registered', () => {
        registeredCount++
        if (registeredCount === 3) {
            logger.info('demo: all 3 readings registered in condo — shutting down')
            mqttAdapter.stop()
            brokerServer.close()
            process.exit(0)
        }
    })
    bridge.on('registerError', ({ error }) => {
        logger.error('demo: a reading failed to register:', error.message)
    })

    setTimeout(() => publishFakeReadings(brokerUrl), 1000)

    setTimeout(() => {
        logger.error('demo: timed out waiting for readings to register')
        process.exit(1)
    }, 20000)
}

main().catch((err) => {
    logger.error('demo failed:', err.message)
    process.exit(1)
})
