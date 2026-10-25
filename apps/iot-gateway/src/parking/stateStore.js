const fs = require('fs')

/**
 * Tiny JSON-file store for what this gateway has issued/seen. Losing the file is safe:
 * the next sync simply re-issues every plate (the parking system treats that as an update).
 */
class StateStore {
    constructor (filePath) {
        this.filePath = filePath
        this.state = { issued: {}, seenEvents: [] }
        try {
            this.state = { ...this.state, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) }
        } catch (err) {
            // first run, or unreadable file — start clean
        }
    }

    get issued () { return this.state.issued }

    setIssued (plate, value) { this.state.issued[plate] = value }

    removeIssued (plate) { delete this.state.issued[plate] }

    /** @returns {boolean} true when the event was not seen before */
    markEventSeen (key) {
        if (this.state.seenEvents.includes(key)) return false
        this.state.seenEvents.push(key)
        if (this.state.seenEvents.length > 5000) this.state.seenEvents.splice(0, this.state.seenEvents.length - 5000)
        return true
    }

    save () {
        fs.writeFileSync(this.filePath, JSON.stringify(this.state))
    }
}

module.exports = { StateStore }
