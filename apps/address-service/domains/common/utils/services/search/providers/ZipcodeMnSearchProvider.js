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
 * programmatic access, and the response shape below is inferred from a handful of observed
 * examples, not a spec. Before relying on this in production: (1) get official confirmation from
 * whoever runs zipcode.mn that server-to-server use is fine, since this only reverse-engineers a
 * browser widget, and (2) treat the `addr` field parsing in `normalize()` as best-effort - it
 * assumes a fixed comma-separated layout that may not hold for every building.
 *
 * @see https://zipcode.mn/zipcodemap - the map widget this was reverse-engineered from
 */

const BASE_URL = 'https://zipcode.mn/Service'

/**
 * @typedef {Object} ZipcodeMnBuilding
 * @property {string} [name_mn]
 * @property {string} [name_en]
 * @property {string} [addr] Comma-separated: "{building name}, {khoroo}, {district}, city, {zipcode}[-{suffix}]"
 * @property {string} [zipcode] Building-level postal code, e.g. "14220-0010"
 * @property {string} [status]
 * @property {number} [bldng_purpose_id] 1101 observed for residential buildings
 * @property {string} [geom] A JSON-encoded GeoJSON geometry (usually a Polygon - the building footprint)
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
     * @returns {Promise<ZipcodeMnBuilding[]>}
     */
    async get ({ query, context = null, helpers = {} }) {
        try {
            const searchResult = await callService({ func: 'search', searchValue: query })
            const matches = get(searchResult, 'data', [])

            const ret = []
            for (const match of matches) {
                const zipcode = get(match, 'zipcode')
                if (!zipcode) continue

                const details = await this.getByZipCode(zipcode)
                if (details) ret.push(details)
            }

            return ret
        } catch (err) {
            this.logger.error({ msg: 'zipcode.mn search error', err })
            return []
        }
    }

    /**
     * @param {string} zipcode
     * @returns {Promise<ZipcodeMnBuilding|null>}
     */
    async getByZipCode (zipcode) {
        try {
            const result = await callService({ func: 'getByZipCode', zipcode })
            return get(result, ['data', 0]) || null
        } catch (err) {
            this.logger.error({ msg: 'zipcode.mn getByZipCode error', zipcode, err })
            return null
        }
    }

    /**
     * Best-effort parse of the "{name}, {khoroo}, {district}, {city}, {zipcode}[-{suffix}]" address
     * string - see the module-level warning about how reliable this actually is.
     * @param {string} addr
     * @returns {{house: ?string, city_district: ?string, area: ?string, city: ?string}}
     */
    parseAddr (addr) {
        if (!addr) return { house: null, city_district: null, area: null, city: null }

        const parts = addr.split(/,\s*/).filter(Boolean)
        if (parts.length < 4) return { house: parts[0] || null, city_district: null, area: null, city: null }

        const [house, khoroo, district, city] = parts
        return { house, city_district: khoroo, area: district, city }
    }

    /**
     * @param {ZipcodeMnBuilding[]} data
     * @returns {NormalizedBuilding[]}
     */
    normalize (data) {
        return data.map((item) => {
            const addr = get(item, 'addr')
            const { house, city_district, area, city } = this.parseAddr(addr)

            let geoLat, geoLon
            const geomRaw = get(item, 'geom')
            if (geomRaw) {
                try {
                    const centroid = centroidOf(JSON.parse(geomRaw))
                    if (centroid) {
                        geoLat = centroid.lat
                        geoLon = centroid.lon
                    }
                } catch (err) {
                    this.logger.warn({ msg: 'zipcode.mn failed to parse geom', err })
                }
            }

            return {
                value: addr || get(item, 'name_mn'),
                unrestricted_value: addr || get(item, 'name_mn'),
                rawValue: get(item, 'zipcode'),
                data: {
                    postal_code: get(item, 'zipcode'),
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

        const zipcode = get(normalizedBuilding, ['provider', 'rawData', 'zipcode'])
        if (zipcode) {
            heuristics.push({
                type: HEURISTIC_TYPE_ZIPCODE_MN,
                value: zipcode,
                reliability: 90,
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
