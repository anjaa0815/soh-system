/**
 * A real `/suggest` backend for Mongolia, backed by OpenStreetMap's Nominatim geocoder.
 *
 * The upstream address-service only wires up Dadata/Google/Pullenti, all built around
 * Russian/CIS address data - none of them help here. Nominatim is free, has no API key,
 * and has decent coverage of Mongolian settlements, streets and buildings (best in
 * Ulaanbaatar, thinner in rural areas since it's community-mapped).
 *
 * IMPORTANT - Nominatim's public usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - max ~1 request/second, no parallel requests
 *   - a real, identifying User-Agent is required (set OSM_USER_AGENT below)
 *   - no heavy/production autocomplete traffic against the public server
 * This is fine for local dev and demos. Before going to production, either self-host
 * Nominatim (https://github.com/mediagis/nominatim-docker) or switch to a paid geocoder.
 *
 * Usage: node bin/osm-address-suggest-server.js
 * Then point ADDRESS_SERVICE_URL at it, e.g. ADDRESS_SERVICE_URL=http://localhost:3000
 */
const express = require('express')

const PORT = process.env.PORT || 3000
const OSM_USER_AGENT = process.env.OSM_USER_AGENT || 'hotoch-condo-dev/1.0 (contact: help@example.com)'
const MIN_REQUEST_INTERVAL_MS = 1100 // stay under Nominatim's ~1 req/sec limit

const app = express()

let lastRequestAt = 0
async function waitForRateLimit () {
    const now = Date.now()
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - now)
    if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
    }
    lastRequestAt = Date.now()
}

function buildDisplayAddress (address = {}) {
    // Nominatim's `address` object varies a lot by place - pick the most specific parts
    // that exist, most-specific first, matching how Mongolian addresses are usually written.
    const parts = [
        address.house_number,
        address.road,
        address.suburb || address.city_district || address.quarter,
        address.city || address.town || address.village,
        address.state,
    ].filter(Boolean)

    return parts.length > 0 ? parts.join(', ') : null
}

app.get('/suggest', async (req, res) => {
    const query = String(req.query.s || '').trim()

    if (!query) {
        res.json([])
        return
    }

    try {
        await waitForRateLimit()

        const url = new URL('https://nominatim.openstreetmap.org/search')
        url.searchParams.set('q', query)
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('addressdetails', '1')
        url.searchParams.set('countrycodes', 'mn')
        url.searchParams.set('limit', '5')
        url.searchParams.set('accept-language', 'mn')

        const response = await fetch(url, {
            headers: { 'User-Agent': OSM_USER_AGENT },
        })

        if (!response.ok) {
            console.error(`Nominatim request failed: ${response.status} ${await response.text()}`)
            res.json([])
            return
        }

        const results = await response.json()

        const suggestions = results.map((result) => {
            const displayAddress = buildDisplayAddress(result.address) || result.display_name
            const isHouse = result.addresstype === 'house' || Boolean(result.address?.house_number)

            return {
                value: displayAddress,
                rawValue: `osm:${result.osm_type}:${result.osm_id}`,
                type: isHouse ? 'building' : null,
                data: {
                    house_type_full: isHouse ? 'дом' : null,
                    country: result.address?.country,
                    region: result.address?.state,
                    city: result.address?.city || result.address?.town || result.address?.village,
                    street: result.address?.road,
                    house: result.address?.house_number,
                    geo_lat: result.lat,
                    geo_lon: result.lon,
                },
            }
        })

        res.json(suggestions)
    } catch (error) {
        console.error('OSM suggest error:', error)
        res.json([])
    }
})

app.listen(PORT, () => {
    console.log(`OSM-backed address-suggest server listening on port ${PORT}`)
})
