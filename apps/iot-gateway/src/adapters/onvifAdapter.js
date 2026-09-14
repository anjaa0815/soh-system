const { EventEmitter } = require('events')

const { Cam } = require('onvif')

const { logger } = require('../logger')

/**
 * Connects to an ONVIF-compliant video device on the compound's own local/internal
 * network — a single IP camera, or an NVR (Network Video Recorder) exposing several
 * camera channels through one ONVIF endpoint, which is the common setup for a gate/
 * entrance access-control system. This is a deliberate design point, not an
 * afterthought: this adapter (and this whole gateway) is meant to run *inside* the
 * compound's LAN, next to the NVR — it never exposes the NVR or raw camera streams to
 * the internet. Only normalized events (and, if wired up, snapshots) leave the LAN,
 * pushed out to condo's API. See README.md "Deployment: runs on the compound's LAN".
 *
 * `onvif`'s `Cam.connect()` calls ONVIF's GetProfiles under the hood and populates
 * `cam.profiles` — one entry per channel on an NVR, or a single entry for one camera.
 * This adapter treats every profile as a "channel" so the same code path handles both.
 *
 * Turns motion/tamper events into 'motionEvent' events. Unlike meter readings, camera
 * events don't map onto a single generic condo mutation — what should happen (open a
 * ticket? log an incident? just notify someone?) depends on the organization's ticket
 * classifiers and property setup. So this adapter only normalizes the *event*; wiring
 * it to a condo action is left to the integrator (see README's "Wiring camera events").
 *
 * NEEDS REAL HARDWARE TO RUN: an ONVIF-compliant camera or NVR reachable on the local
 * network. Not exercised against real hardware in this scaffold.
 *
 * @typedef {Object} CameraConfig
 * @property {string} hostname - the camera's or NVR's IP/hostname on the local network
 * @property {number} port - typically 80 or 8000 for ONVIF's device service
 * @property {string} username
 * @property {string} password
 * @property {string} [label] - human-readable name for logs/events, defaults to hostname
 *
 * @typedef {Object} Channel
 * @property {string} device - the CameraConfig.label this channel belongs to
 * @property {string} profileToken - ONVIF profile token, unique per channel on that device
 * @property {string} name - the channel's ONVIF profile name (often "Gate 1", "Entrance", etc.)
 */
class OnvifAdapter extends EventEmitter {
    /**
     * @param {CameraConfig[]} cameras - one entry per physical camera OR per NVR (an
     *   NVR entry will surface multiple channels once connected, all under that entry's
     *   hostname/credentials)
     */
    constructor (cameras) {
        super()
        this.cameras = cameras
        /** @type {Map<string, import('onvif').Cam>} keyed by CameraConfig.label */
        this._cams = new Map()
    }

    async start () {
        for (const cameraConfig of this.cameras) {
            await this._connectDevice(cameraConfig)
        }
        return this
    }

    stop () {
        // The `onvif` package doesn't expose an explicit disconnect; dropping references
        // is enough since events are delivered via a NOTIFY subscription the device owns.
        this._cams.clear()
    }

    /**
     * @returns {Channel[]} every channel across every connected camera/NVR
     */
    listChannels () {
        const channels = []
        for (const [label, cam] of this._cams) {
            for (const profile of cam.profiles || []) {
                channels.push({ device: label, profileToken: profile.$.token, name: profile.name })
            }
        }
        return channels
    }

    /**
     * Fetches a still image URI for one channel — the cheap, no-transcoding way to
     * show "what a camera currently sees" (e.g. periodic polling in a UI), as opposed
     * to a live video stream, which needs the browser-facing infra described in
     * README.md ("From snapshots to live video").
     * @param {string} device - a CameraConfig.label
     * @param {string} profileToken
     * @returns {Promise<string>} the snapshot's URI (still needs the device's own auth to fetch)
     */
    getSnapshotUri (device, profileToken) {
        const cam = this._requireCam(device)
        return new Promise((resolve, reject) => {
            cam.getSnapshotUri({ profileToken }, (err, result) => {
                if (err) return reject(err)
                resolve(result.uri)
            })
        })
    }

    /**
     * Fetches an RTSP stream URI for one channel. Playing this in a browser needs
     * transcoding (ffmpeg to HLS, or a WebRTC bridge) — see README.md.
     * @param {string} device - a CameraConfig.label
     * @param {string} profileToken
     * @returns {Promise<string>}
     */
    getStreamUri (device, profileToken) {
        const cam = this._requireCam(device)
        return new Promise((resolve, reject) => {
            cam.getStreamUri({ profileToken, protocol: 'RTSP' }, (err, result) => {
                if (err) return reject(err)
                resolve(result.uri)
            })
        })
    }

    _requireCam (device) {
        const cam = this._cams.get(device)
        if (!cam) throw new Error(`onvif: unknown device "${device}" — check the "label" in your ONVIF_CAMERAS config`)
        return cam
    }

    _connectDevice (cameraConfig) {
        const label = cameraConfig.label || cameraConfig.hostname

        return new Promise((resolve, reject) => {
            const cam = new Cam(cameraConfig, (err) => {
                if (err) {
                    reject(new Error(`onvif: failed to connect to "${label}": ${err.message}`))
                    return
                }

                this._cams.set(label, cam)
                const channelNames = (cam.profiles || []).map((p) => p.name).join(', ') || '(no channels reported)'
                logger.info(`onvif: connected to "${label}" — channels: ${channelNames}`)

                cam.on('event', (event) => this._handleEvent(label, cam, event))

                resolve()
            })
        })
    }

    _handleEvent (label, cam, event) {
        const topic = event && event.topic && event.topic._
        // Motion/tamper topics vary by manufacturer; this covers the common
        // ONVIF-standard "RuleEngine/CellMotionDetector/Motion" family — check
        // your device's actual event topics (e.g. via `cam.getEventProperties`)
        // and adjust this filter.
        if (!topic || !topic.includes('MotionDetector')) return

        // On an NVR, the event's message Source usually names which channel/profile
        // triggered it — a single-camera device may omit this.
        const sourceToken = extractSourceToken(event)
        const channel = (cam.profiles || []).find((p) => p.$.token === sourceToken)

        this.emit('motionEvent', {
            device: label,
            channel: channel ? channel.name : sourceToken || null,
            profileToken: sourceToken || null,
            topic,
            occurredAt: new Date().toISOString(),
            raw: event,
        })
    }
}

function extractSourceToken (event) {
    const items = event && event.message && event.message.message &&
        event.message.message.source && event.message.message.source.simpleItem
    const sourceItems = Array.isArray(items) ? items : [items].filter(Boolean)
    const tokenItem = sourceItems.find((item) => item && item.$ && /token/i.test(item.$.Name || ''))
    return tokenItem && tokenItem.$.Value
}

module.exports = { OnvifAdapter }
