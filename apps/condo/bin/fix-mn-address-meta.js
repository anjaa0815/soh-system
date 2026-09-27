/**
 * One-off fix of address metadata written by FakeAddressServiceClient before it learned to split
 * Mongolian addresses: such rows render as "д null" with a random region (e.g. "Kentucky").
 * Recomputes city / street / house from the address text for every table storing address metadata.
 *
 * Usage (from apps/condo): node bin/fix-mn-address-meta.js
 */
const path = require('path')

const { splitAddress } = require('@open-condo/clients/address-service-client/FakeAddressServiceClient')
const { prepareKeystoneExpressApp } = require('@open-condo/keystone/prepareKeystoneApp')

// [table, address column, address meta column]
const TABLES = [
    ['Property', 'address', 'addressMeta'],
    ['BillingProperty', 'address', 'addressMeta'],
    ['Resident', 'address', 'addressMeta'],
    ['MeterResourceOwner', 'address', 'addressMeta'],
    ['B2CAppProperty', 'address', 'addressMeta'],
    ['IncidentProperty', 'propertyAddress', 'propertyAddressMeta'],
    ['Ticket', 'propertyAddress', 'propertyAddressMeta'],
]

async function main () {
    const { keystone } = await prepareKeystoneExpressApp(path.resolve('./index.js'), { excludeApps: ['NextApp', 'AdminUIApp'] })
    const knex = keystone.adapter.knex

    for (const [table, addressColumn, metaColumn] of TABLES) {
        // Rows created by the old fake client: house type "д" without a house
        const rows = await knex(table)
            .select('id', addressColumn, metaColumn)
            .whereRaw('??->\'data\'->>\'house_type\' = \'д\' AND ??->\'data\'->>\'house\' IS NULL', [metaColumn, metaColumn])
        let fixed = 0
        for (const row of rows) {
            const address = row[addressColumn]
            const { city, street, house } = splitAddress(address || '')
            if (!city) continue
            const meta = row[metaColumn]
            meta.data = {
                ...meta.data,
                country: 'Монгол',
                region: city,
                city,
                city_with_type: city,
                street_with_type: street,
                house_type: null,
                house,
            }
            await knex(table).where({ id: row.id }).update({ [metaColumn]: meta })
            fixed++
        }
        console.info(`${table}: fixed ${fixed} of ${rows.length}`)
    }
}

main().then(() => process.exit(), (error) => {
    console.error(error)
    process.exit(1)
})
