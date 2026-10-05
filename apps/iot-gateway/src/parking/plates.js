/**
 * Licence plate helpers. Plates are compared in a normalized form (upper-case, no
 * spaces/dashes) because residents, staff and the ALPR camera all write them differently:
 * "1234 уба", "1234-УБА" and "1234УБА" are the same vehicle.
 */

function normalizePlate (value) {
    return String(value || '').toUpperCase().replace(/[\s\-_.]/g, '')
}

/**
 * Accepts whatever a CustomValue of the "plates" CustomField holds and returns a clean list.
 * Supported shapes:
 *   "1234УБА, 5678УНА"                                   (String field)
 *   ["1234УБА", "5678УНА"]                                (Json field)
 *   [{ plate: "1234УБА", validUntil: "2026-12-31" }]      (Json field, with expiry)
 *   { plates: [...] }                                     (Json field, wrapped)
 * @returns {{ plate: string, validUntil: string|null }[]}
 */
function parsePlatesValue (data) {
    if (data === null || data === undefined) return []
    let items = data
    if (typeof data === 'string') items = data.split(/[,;\n]/)
    else if (!Array.isArray(data) && Array.isArray(data.plates)) items = data.plates
    if (!Array.isArray(items)) return []

    const seen = new Set()
    const result = []
    for (const item of items) {
        const plate = normalizePlate(typeof item === 'string' ? item : item && item.plate)
        if (plate.length < 4 || seen.has(plate)) continue
        seen.add(plate)
        const validUntil = (item && typeof item === 'object' && item.validUntil) ? String(item.validUntil).slice(0, 10) : null
        result.push({ plate, validUntil })
    }
    return result
}

module.exports = { normalizePlate, parsePlatesValue }
