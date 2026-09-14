const { Bridge } = require('./bridge')
const { CondoClient } = require('./condoClient')
const { config } = require('./config')
const { logger } = require('./logger')
const { MqttAdapter } = require('./adapters/mqttAdapter')
const { OnvifAdapter } = require('./adapters/onvifAdapter')
const { Rs485Adapter } = require('./adapters/rs485Adapter')

async function main () {
    const condoClient = new CondoClient(config.condo)
    const bridge = new Bridge(condoClient)

    if (config.mqtt.enabled) {
        const mqttAdapter = new MqttAdapter(config.mqtt).start()
        bridge.useMeterAdapter(mqttAdapter)
    }

    if (config.rs485.enabled) {
        const rs485Adapter = new Rs485Adapter(config.rs485)
        await rs485Adapter.start()
        bridge.useMeterAdapter(rs485Adapter)
    }

    if (config.onvif.enabled) {
        const onvifAdapter = new OnvifAdapter(config.onvif.cameras)
        await onvifAdapter.start()
        logger.info('onvif: channels available', onvifAdapter.listChannels())
        bridge.useCameraAdapter(onvifAdapter, async (event) => {
            // TODO: wire this to whatever condo action fits your organization —
            // e.g. call a createTicket-style mutation with the right property/classifier
            // ids for the camera's location. See README.md, "Wiring camera events".
            logger.warn('motion event received but no condo action is wired up yet', event.device, event.channel)
        })
    }

    if (!config.mqtt.enabled && !config.rs485.enabled && !config.onvif.enabled) {
        logger.warn('no adapters enabled — set MQTT_ENABLED / RS485_ENABLED / ONVIF_ENABLED in .env')
    }
}

main().catch((err) => {
    logger.error('fatal:', err.message)
    process.exit(1)
})
