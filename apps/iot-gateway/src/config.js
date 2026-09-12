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
}

module.exports = { config }
