/**
 * Read-only connectivity check for the parking adapter: talks to the parking server
 * (heartbeat, occupancy, last hour of entries/exits) and, if a plates CustomField is
 * configured, lists what condo would sync. Changes nothing on either side.
 *
 *   npm run parking:check
 */
const { ParkingAdapter } = require('../src/adapters/parkingAdapter')
const { CondoClient } = require('../src/condoClient')
const { config } = require('../src/config')

async function main () {
    const adapter = new ParkingAdapter(config.parking)
    console.log('Parking server :', config.parking.baseUrl)
    console.log('  parking no.  :', await adapter.heartbeat())
    const occupancy = await adapter.getOccupancy()
    console.log('  occupancy    :', `${occupancy.free} free of ${occupancy.total}`)
    const since = new Date(Date.now() - 3600000)
    const entries = await adapter.getEntries(since)
    const exits = await adapter.getExits(since)
    console.log('  last hour    :', `${entries.length} in, ${exits.length} out`)
    if (entries[0]) console.log('  sample entry :', JSON.stringify(entries[0].raw))
    if (exits[0]) console.log('  sample exit  :', JSON.stringify(exits[0].raw))

    if (!config.parking.platesCustomFieldId) {
        console.log('\nPARKING_PLATES_CUSTOM_FIELD_ID is not set — skipping the condo side.')
        return
    }
    const condoClient = new CondoClient(config.condo)
    const vehicles = await condoClient.getVehicleRegistrations(config.parking.platesCustomFieldId)
    console.log('\ncondo          :', config.condo.apiUrl)
    console.log('  plates found :', vehicles.length)
    for (const vehicle of vehicles.slice(0, 10)) {
        console.log(`   ${vehicle.plate}  ${vehicle.contact.name || ''}  ${vehicle.contact.unitName || ''}  ${vehicle.validUntil || ''}`)
    }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1) })
