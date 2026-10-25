/**
 * Pure diffing between "what condo says should have access" and "what this gateway has
 * already issued in the parking system". Kept free of I/O so it can be unit tested.
 *
 * The gateway only ever cancels plates it issued itself (tracked in the state file) —
 * monthly cars a cashier registered by hand in the parking system are never touched.
 */

function fingerprint (registration) {
    return [registration.name, registration.phone, registration.unitLabel, registration.startDate, registration.endDate].join('|')
}

/**
 * @param {Array<{plate: string}>} desired - registrations resolved from condo
 * @param {Object<string, {fingerprint: string}>} issued - state: plate -> what we last sent
 * @returns {{ toIssue: Array, toCancel: string[], unchanged: number }}
 */
function planSync (desired, issued) {
    const toIssue = []
    const desiredPlates = new Set()
    let unchanged = 0

    for (const registration of desired) {
        desiredPlates.add(registration.plate)
        const previous = issued[registration.plate]
        if (previous && previous.fingerprint === fingerprint(registration)) unchanged++
        else toIssue.push(registration)
    }

    const toCancel = Object.keys(issued).filter((plate) => !desiredPlates.has(plate))

    return { toIssue, toCancel, unchanged }
}

module.exports = { planSync, fingerprint }
