const { EventEmitter } = require('events')

const { Cam } = require('onvif')

const { logger } = require('../logger')

/**
 * Connects to ONVIF-compliant IP cameras and turns their motion/tamper events into
 * 'motionEvent' events. Unlike meter readings, camera events don't map onto a single
 * generic condo mutation — what should happen (open a ticket? log an incident? just
 * notify someone?) depends on the organization's ticket classifiers and property setup.
 * So this adapter only normalizes the *event*; wiring it to a condo action is left to
 * the integrator (see README's "Wiring camera events to condo" section).
 *
 * NEEDS REAL HARDWARE TO RUN: an ONVIF-compliant IP camera reachable on the network.
 * Not exercised against real hardware in this scaffold.
 *
 * @typedef {Object} CameraConfig
 * @property {string} hostname
 * @property {number} port
 * @property {string} username
 * @property {string} password
 * @property {string} [label] - human-readable name for logs/events, defaults to hostname
 */
class OnvifAdapter extends EventEmitter {
    /**
     * @param {CameraConfig[]} cameras
     */
    constructor (cameras) {
        super()
        this.cameras = cameras
        this._cams = []
    }

    async start () {
        for (const cameraConfig of this.cameras) {
            await this._connectCamera(cameraConfig)
        }
        return this
    }

    stop () {
        // The `onvif` package doesn't expose an explicit disconnect; dropping references
        // is enough since events are delivered via a NOTIFY subscription the camera owns.
        this._cams = []
    }

    _connectCamera (cameraConfig) {
        const label = cameraConfig.label || cameraConfig.hostname

        return new Promise((resolve, reject) => {
            const cam = new Cam(cameraConfig, (err) => {
                if (err) {
                    reject(new Error(`onvif: failed to connect to camera "${label}": ${err.message}`))
                    return
                }

                logger.info(`onvif: connected to camera "${label}"`)
                this._cams.push(cam)

                cam.on('event', (event) => {
                    const topic = event && event.topic && event.topic._
                    // Motion/tamper topics vary by manufacturer; this covers the common
                    // ONVIF-standard "RuleEngine/CellMotionDetector/Motion" family — check
                    // your camera's actual event topics (e.g. via `cam.getEventProperties`)
                    // and adjust this filter.
                    if (!topic || !topic.includes('MotionDetector')) return

                    this.emit('motionEvent', {
                        camera: label,
                        topic,
                        occurredAt: new Date().toISOString(),
                        raw: event,
                    })
                })

                resolve()
            })
        })
    }
}

module.exports = { OnvifAdapter }
