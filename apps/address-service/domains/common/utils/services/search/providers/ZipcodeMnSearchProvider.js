const get = require('lodash/get')

const { fetch } = require('@open-condo/keystone/fetch')

const {
    HEURISTIC_TYPE_ZIPCODE_MN,
    HEURISTIC_TYPE_COORDINATES,
    HEURISTIC_TYPE_FALLBACK,
} = require('@address-service/domains/common/constants/heuristicTypes')
const { ZIPCODE_MN_PROVIDER } = require('@address-service/domains/common/constants/providers')

const { AbstractSearchProvider } = require('./AbstractSearchProvider')

/**
 * zipcode.mn is a Mongolian building-level postal code map (Ulaanbaatar).
 * It's an UNDOCUMENTED, third-party service discovered by inspecting its public map widget's
 * client-side JS (`mapp.js`) - there's no official API contract, no published terms of use for
 * programmatic access, and the response shape below is inferred from real observed responses
 * (verified against ~200 real records from `search`/`getByZipCode`), not a spec. Before relying
 * on this in production, get official confirmation from whoever runs zipcode.mn that
 * server-to-server use is fine, since this only reverse-engineers a browser widget.
 *
 * Two endpoints matter here, and they return DIFFERENT shapes for the same conceptual place:
 * - `search` (by name) returns a flat list of matches, each already carrying a formatted `addr`
 *   string, a `level` ("l3" for a khoroolol/area, "l4" for a building) and an `id`.
 * - `getByZipCode` (by zipcode) returns EVERY record that shares that zipcode: the khoroolol
 *   "container" record itself (`source_table: "level3"`, no `addr`, just `name_mn`/`geom`/`point`)
 *   followed by every building inside it (`source_table: "level4"`, has `addr`). A zipcode is
 *   shared by a whole khoroolol's worth of buildings - it does NOT uniquely identify one building
 *   (a separate `postcode` field, e.g. 5, is what makes `{zipcode}-{postcode}` building-specific,
 *   and many buildings don't even have one). So `getByZipCode(zipcode).data[0]` is (almost always)
 *   the unrelated level3 container, not the building being searched for - it must be matched by
 *   name instead, see `get()`.
 *
 * IMPORTANT, empirically confirmed limitation: `search` only ever matched khoroolol/district-level
 * (level3) names in testing - full and partial building names ("Эрдэнэсийн арал хотхон",
 * "Эрдэнэсийн арал") returned zero results, while khoroolol names ("28-р хороолол", "хороолол")
 * matched reliably. So as a text-search provider this can basically only resolve the general
 * area/khoroolol a query mentions (with real coordinates, via `getByZipCode`'s level3 record),
 * never a specific building by name - level4 records only ever show up as entries *inside* a
 * `getByZipCode` response, not as `search` hits. Callers relying on this for a resident to type
 * their building/khotkhon name and get a house-level match will get no results; that's expected,
 * not a bug, and is exactly why this is meant to sit in a fallback chain (e.g.
 * `PROVIDER=zipcode_mn,google`) rather than be used alone.
 *
 * @see https://zipcode.mn/zipcodemap - the map widget this was reverse-engineered from
 */

const BASE_URL = 'https://zipcode.mn/Service'

/**
 * @typedef {Object} ZipcodeMnBuilding
 * @property {string} [name_mn]
 * @property {string} [name_en]
 * @property {string} [addr] Comma-separated: "{name}, {district}, city, {zipcode}[-{postcode}]" -
 * no khoroo name/number is embedded in this string, that only exists as `bldng_khoroo_number`
 * @property {string} [zipcode] The area's postal code, shared by every building in it, e.g. "17130"
 * @property {number} [postcode] Building-specific suffix within the zipcode, e.g. 5 (=> "17130-0005")
 * @property {number} [bldng_khoroo_number] Khoroo number, e.g. 21 - not present in `addr` text
 * @property {string} [source_table] "level3" (khoroolol/area) or "level4" (a single building)
 * @property {string} [status]
 * @property {number} [bldng_purpose_id] 1101/1102 observed for residential buildings
 * @property {string} [geom] A JSON-encoded GeoJSON geometry (usually a Polygon - the building footprint)
 * @property {string} [point] A JSON-encoded GeoJSON Point - a ready-made centroid, seen on level3 records
 */

async function callService (body) {
    const answer = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })

    if (answer.status !== 200) return null

    return await answer.json()
}

/**
 * Computes a simple centroid (average of ring points) from a GeoJSON Polygon/MultiPolygon.
 * Good enough for a representative point - not a true geometric centroid.
 * @param {Object} geoJson
 * @returns {{lat: number, lon: number}|null}
 */
function centroidOf (geoJson) {
    const type = get(geoJson, 'type')
    let ring
    if (type === 'Polygon') {
        ring = get(geoJson, ['coordinates', 0])
    } else if (type === 'MultiPolygon') {
        ring = get(geoJson, ['coordinates', 0, 0])
    }
    if (!Array.isArray(ring) || ring.length === 0) return null

    const sum = ring.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 })
    return { lat: sum.lat / ring.length, lon: sum.lon / ring.length }
}

/**
 * The zipcode.mn search provider
 */
class ZipcodeMnSearchProvider extends AbstractSearchProvider {

    getProviderName () {
        return ZIPCODE_MN_PROVIDER
    }

    /**
     * `search` already returns a usable `addr` per match, so matches are used as-is for text.
     * `geom`/`point` (needed for coordinates) are only available via `getByZipCode`, whose result
     * is a whole zipcode's worth of unrelated records - so the matching one has to be picked out
     * by name rather than assumed to be first, see the module-level note above.
     * @returns {Promise<ZipcodeMnBuilding[]>}
     */
    async get ({ query, context = null, helpers = {} }) {
        try {
            const searchResult = await callService({ func: 'search', searchValue: query })
            const matches = get(searchResult, 'data', []).filter((match) => get(match, 'zipcode'))

            const ret = []
            for (const match of matches) {
                const geoSource = await this.findGeoSource(match)
                ret.push(geoSource ? { ...match, geom: geoSource.geom, point: geoSource.point } : match)
            }

            return ret
        } catch (err) {
            this.logger.error({ msg: 'zipcode.mn search error', err })
            return []
        }
    }

    /**
     * Finds the `getByZipCode` record that corresponds to a given `search` match, so its
     * geometry can be borrowed - matched by name since zipcodes aren't building-unique.
     * Best-effort: returns null (no geometry) rather than throwing when nothing lines up.
     * @param {ZipcodeMnBuilding} match
     * @returns {Promise<ZipcodeMnBuilding|null>}
     */
    async findGeoSource (match) {
        try {
            const candidates = await this.getByZipCode(get(match, 'zipcode'))
            const name = get(match, 'name_mn')

            return candidates.find((c) => get(c, 'name_mn') === name && get(c, 'source_table') === 'level4')
                || candidates.find((c) => get(c, 'name_mn') === name)
                || candidates.find((c) => get(c, 'source_table') === 'level3')
                || null
        } catch (err) {
            this.logger.warn({ msg: 'zipcode.mn failed to find matching geometry, continuing without it', err })
            return null
        }
    }

    /**
     * @param {string} zipcode
     * @returns {Promise<ZipcodeMnBuilding[]>}
     */
    async getByZipCode (zipcode) {
        try {
            const result = await callService({ func: 'getByZipCode', zipcode })
            return get(result, 'data', [])
        } catch (err) {
            this.logger.error({ msg: 'zipcode.mn getByZipCode error', zipcode, err })
            return []
        }
    }

    /**
     * Best-effort parse of the "{name}, {district}, {city}, {zipcode}[-{postcode}]" address string
     * - verified against ~200 real records. There is no khoroo name/number in this string; when
     * the source record has a `bldng_khoroo_number`, `normalize()` uses that for `area` instead.
     * @param {string} addr
     * @returns {{house: ?string, city_district: ?string, city: ?string}}
     */
    parseAddr (addr) {
        if (!addr) return { house: null, city_district: null, city: null }

        const parts = addr.split(/,\s*/).filter(Boolean)
        if (parts.length < 3) return { house: parts[0] || null, city_district: null, city: null }

        const [house, district, city] = parts
        return { house, city_district: district, city }
    }

    /**
     * @param {ZipcodeMnBuilding[]} data
     * @returns {NormalizedBuilding[]}
     */
    normalize (data) {
        return data.map((item) => {
            const addr = get(item, 'addr')
            const { house, city_district, city } = this.parseAddr(addr)

            const khorooNumber = get(item, 'bldng_khoroo_number')
            const area = khorooNumber ? `${khorooNumber}-р хороо` : null

            const zipcode = get(item, 'zipcode')
            const postcode = get(item, 'postcode')
            const postalCode = postcode ? `${zipcode}-${String(postcode).padStart(4, '0')}` : zipcode

            let geoLat, geoLon
            const pointRaw = get(item, 'point')
            const geomRaw = get(item, 'geom')
            try {
                if (pointRaw) {
                    const point = JSON.parse(pointRaw)
                    const coords = get(point, 'coordinates')
                    if (Array.isArray(coords)) {
                        geoLon = coords[0]
                        geoLat = coords[1]
                    }
                } else if (geomRaw) {
                    const centroid = centroidOf(JSON.parse(geomRaw))
                    if (centroid) {
                        geoLat = centroid.lat
                        geoLon = centroid.lon
                    }
                }
            } catch (err) {
                this.logger.warn({ msg: 'zipcode.mn failed to parse geometry', err })
            }

            return {
                value: addr || get(item, 'name_mn'),
                unrestricted_value: addr || get(item, 'name_mn'),
                rawValue: zipcode,
                data: {
                    postal_code: postalCode,
                    country: 'Mongolia',
                    country_iso_code: 'MN',
                    city,
                    city_district,
                    area,
                    house,
                    geo_lat: geoLat,
                    geo_lon: geoLon,
                },
                provider: {
                    name: ZIPCODE_MN_PROVIDER,
                    rawData: item,
                },
            }
        })
    }

    /**
     * @param {import('@address-service/domains/common/utils/services/index.js').NormalizedBuilding} normalizedBuilding
     * @returns {Array<{type: string, value: string, reliability: number, meta?: object}>}
     */
    extractHeuristics (normalizedBuilding) {
        const heuristics = []

        // A bare `zipcode` is shared by ~100+ buildings in the same khoroolol - only the combined
        // `postal_code` (zipcode[-postcode]) computed in normalize() comes close to identifying a
        // single building, and even that's absent for most buildings observed so far.
        const postalCode = get(normalizedBuilding, ['data', 'postal_code'])
        const hasPostcode = get(normalizedBuilding, ['provider', 'rawData', 'postcode']) != null
        if (postalCode) {
            heuristics.push({
                type: HEURISTIC_TYPE_ZIPCODE_MN,
                value: postalCode,
                reliability: hasPostcode ? 90 : 40,
                meta: null,
            })
        }

        const geoLat = get(normalizedBuilding, ['data', 'geo_lat'])
        const geoLon = get(normalizedBuilding, ['data', 'geo_lon'])
        if (geoLat != null && geoLon != null) {
            heuristics.push({
                type: HEURISTIC_TYPE_COORDINATES,
                value: `${geoLat},${geoLon}`,
                reliability: 80,
                meta: null,
            })
        }

        const fallbackKey = this.generateFallbackKey(normalizedBuilding)
        if (fallbackKey) {
            heuristics.push({
                type: HEURISTIC_TYPE_FALLBACK,
                value: fallbackKey,
                reliability: 10,
                meta: null,
            })
        }

        return heuristics
    }
}

module.exports = { ZipcodeMnSearchProvider }
