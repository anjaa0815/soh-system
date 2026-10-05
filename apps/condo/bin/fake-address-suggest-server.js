/**
 * Minimal stand-in for the `address-service` app's `/suggest` endpoint, for local dev only.
 *
 * The real address-service only wires up Dadata/Google/Pullenti providers, all built around
 * Russian/CIS address databases - none of which cover Mongolia, so running the real service
 * wouldn't return usable suggestions here anyway. This just echoes back whatever the user
 * typed as a single valid "building" suggestion, so address-entry forms can be exercised
 * end-to-end without a live geocoding backend.
 *
 * Usage: node bin/fake-address-suggest-server.js
 * Then point ADDRESS_SERVICE_URL at it, e.g. ADDRESS_SERVICE_URL=http://localhost:3000
 */
const express = require('express')

const PORT = process.env.PORT || 3000

const app = express()

app.get('/suggest', (req, res) => {
    const query = String(req.query.s || '').trim()

    if (!query) {
        res.json([])
        return
    }

    res.json([
        {
            value: query,
            rawValue: query,
            type: 'building',
            data: {
                house_type_full: 'дом',
                country: 'Монгол улс',
            },
        },
    ])
})

app.listen(PORT, () => {
    console.log(`Fake address-suggest server listening on port ${PORT}`)
})
