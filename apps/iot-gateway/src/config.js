const path = require('path')

require('dotenv').config()

function parseCameras (value) {
    if (!value) return []
    return value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const [hostname, port, username, password] = entry.split(':')
        return { hostname, port: Number(port), username, password }
    })
}

function parseRs485Devices (value) {
    if (!value) return []
    return value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const [slaveId, meterNumber, resource, registerAddress] = entry.split(':')
        return {
            slaveId: Number(slaveId),
            meterNumber,
            resource,
            registerAddress: Number(registerAddress),
        }
    })
}

const config = {
    condo: {
        apiUrl: process.env.CONDO_API_URL || 'http://localhost:4002/admin/api',
        serviceToken: process.env.CONDO_SERVICE_TOKEN || '',
        organizationId: process.env.CONDO_ORGANIZATION_ID || '',
        b2bAppId: process.env.CONDO_B2B_APP_ID || '',
    },
    mqtt: {
        enabled: process.env.MQTT_ENABLED === 'true',
        brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        topicPattern: process.env.MQTT_TOPIC_PATTERN || 'meters/+/reading',
    },
    onvif: {
        enabled: process.env.ONVIF_ENABLED === 'true',
        cameras: parseCameras(process.env.ONVIF_CAMERAS),
    },
    rs485: {
        enabled: process.env.RS485_ENABLED === 'true',
        serialPort: process.env.RS485_SERIAL_PORT || '/dev/ttyUSB0',
        baudRate: Number(process.env.RS485_BAUD_RATE || 9600),
        devices: parseRs485Devices(process.env.RS485_DEVICES),
        pollIntervalMs: Number(process.env.RS485_POLL_INTERVAL_MS || 60000),
    },
    parking: {
        enabled: process.env.PARKING_ENABLED === 'true',
        baseUrl: process.env.PARKING_API_URL || 'http://127.0.0.1:9001/yard/third',
        monthlyCarType: Number(process.env.PARKING_MONTHLY_CAR_TYPE || 21),
        pollIntervalMs: Number(process.env.PARKING_POLL_INTERVAL_MS || 30000),
        syncIntervalMs: Number(process.env.PARKING_SYNC_INTERVAL_MS || 300000),
        defaultValidDays: Number(process.env.PARKING_DEFAULT_VALID_DAYS || 365),
        platesCustomFieldId: process.env.PARKING_PLATES_CUSTOM_FIELD_ID || '',
        historyCustomFieldId: process.env.PARKING_HISTORY_CUSTOM_FIELD_ID || '',
        stateFile: process.env.PARKING_STATE_FILE || path.resolve(__dirname, '..', 'parking-state.json'),
    },
}

module.exports = { config }
