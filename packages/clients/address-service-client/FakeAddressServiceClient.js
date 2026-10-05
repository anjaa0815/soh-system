const { faker } = require('@faker-js/faker')

const { AddressFromStringParser } = require('@open-condo/clients/address-service-client/utils')

// "<address> @ <lat>,<lon>": an address picked on a map (see PropertyMapPicker in condo)
// "<address> #key:<addressKey>": the address of an existing Property (see MonthlyChargesService in condo).
// Keeps its addressKey, as this fake client forgets the address keys it generated on every restart.
const ADDRESS_WITH_KEY_REGEXP = /^(.+?)\s*#key:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const ADDRESS_WITH_COORDINATES_REGEXP = /^(.+?)\s*@\s*(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/

/**
 * "City, district, khoroo, street 5" -> city / "district, khoroo" / "street 5" (house),
 * so that the address renders naturally instead of fake region and house parts
 * @param {string} address
 * @returns {{ city: string|null, street: string|null, house: string }}
 */
function splitAddress (address) {
    const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
    return {
        city: parts.length > 1 ? parts[0] : null,
        street: parts.length > 2 ? parts.slice(1, -1).join(', ') : null,
        house: parts.length > 1 ? parts[parts.length - 1] : address,
    }
}

class FakeAddressServiceClient {
    addressKeysToSearchResultsMapping = new Map()
    addressSourcesToAddressKeyMapping = new Map()

    /**
     * @param {string} s
     * @param {AddressServiceSearchParams} [params]
     * @returns {Promise<*>}
     * @public
     */
    async search (s, params = {}) {
        if (!s) {
            throw new Error('The `s` parameter is mandatory')
        }

        // Extract unitType and unitName
        let address = s, unitType, unitName
        if (params.extractUnit) {
            const addressParser = new AddressFromStringParser()
            const { address: parsedAddress, unitType: ut, unitName: un } = addressParser.parse(address)
            address = parsedAddress
            if (!!ut && !!un) {
                unitType = ut
                unitName = un
            }
        }

        let geoLat = null, geoLon = null
        if (ADDRESS_WITH_COORDINATES_REGEXP.test(address)) {
            const [, addressWithoutCoordinates, lat, lon] = ADDRESS_WITH_COORDINATES_REGEXP.exec(address)
            address = addressWithoutCoordinates
            geoLat = lat
            geoLon = lon
        }

        let knownAddressKey = null
        if (ADDRESS_WITH_KEY_REGEXP.test(address)) {
            const [, addressWithoutKey, key] = ADDRESS_WITH_KEY_REGEXP.exec(address)
            address = addressWithoutKey
            knownAddressKey = key.toLowerCase()
            if (this.addressKeysToSearchResultsMapping.has(knownAddressKey)) {
                const searchResult = this.addressKeysToSearchResultsMapping.get(knownAddressKey)
                if (!searchResult.addressSources.includes(s)) searchResult.addressSources.push(s)
                this.addressSourcesToAddressKeyMapping.set(s, knownAddressKey)
                return { ...searchResult, unitType, unitName }
            }
        }

        if (!knownAddressKey && this.addressSourcesToAddressKeyMapping.has(address)) {
            return {
                ...this.addressKeysToSearchResultsMapping.get(this.addressSourcesToAddressKeyMapping.get(address)),
                unitType,
                unitName,
            }
        }

        const searchByKeyRegExp = /^key:(.+?)$/
        if (searchByKeyRegExp.test(address)) {
            const [, key] = searchByKeyRegExp.exec(address)
            if (this.addressKeysToSearchResultsMapping.has(key)) {
                return {
                    ...this.addressKeysToSearchResultsMapping.get(key),
                    unitType,
                    unitName,
                }
            } else {
                return null
            }
        }

        const addressKey = knownAddressKey || faker.datatype.uuid()

        const { city, street, house } = splitAddress(address)

        const fiasId = faker.datatype.uuid()
        const addressSources = [address, `fiasId:${fiasId}`, `key:${addressKey}`]
        if (s !== address) addressSources.push(s)
        const searchResult = {
            addressSources,
            address,
            addressKey,
            addressMeta: {
                data: {
                    postal_code: null,
                    country: city ? 'Монгол' : faker.address.country(),
                    country_iso_code: null,
                    federal_district: null,
                    region_fias_id: null,
                    region_kladr_id: null,
                    region_iso_code: null,
                    region_with_type: null,
                    region_type: null,
                    region_type_full: null,
                    region: city || faker.address.state(),
                    area_fias_id: null,
                    area_kladr_id: null,
                    area_with_type: null,
                    area_type: null,
                    area_type_full: null,
                    area: null,
                    city_fias_id: null,
                    city_kladr_id: null,
                    city_with_type: city,
                    city_type: null,
                    city_type_full: null,
                    city,
                    city_area: null,
                    city_district_fias_id: null,
                    city_district_kladr_id: null,
                    city_district_with_type: null,
                    city_district_type: null,
                    city_district_type_full: null,
                    city_district: null,
                    settlement_fias_id: null,
                    settlement_kladr_id: null,
                    settlement_with_type: null,
                    settlement_type: null,
                    settlement_type_full: null,
                    settlement: null,
                    street_fias_id: null,
                    street_kladr_id: null,
                    street_with_type: street,
                    street_type: null,
                    street_type_full: null,
                    street: null,
                    house_fias_id: fiasId,
                    house_kladr_id: null,
                    house_type: city ? null : 'д',
                    house_type_full: 'дом',
                    house: city ? house : null,
                    block_type: null,
                    block_type_full: null,
                    block: null,
                    entrance: null,
                    floor: null,
                    flat_fias_id: null,
                    flat_type: null,
                    flat_type_full: null,
                    flat: null,
                    flat_area: null,
                    square_meter_price: null,
                    flat_price: null,
                    postal_box: null,
                    fias_id: fiasId,
                    fias_code: null,
                    fias_level: null,
                    fias_actuality_state: null,
                    kladr_id: null,
                    geoname_id: null,
                    capital_marker: null,
                    okato: null,
                    oktmo: null,
                    tax_office: null,
                    tax_office_legal: null,
                    timezone: null,
                    geo_lat: geoLat,
                    geo_lon: geoLon,
                    beltway_hit: null,
                    beltway_distance: null,
                    metro: null,
                    qc_geo: null,
                    qc_complete: null,
                    qc_house: null,
                    history_values: null,
                    unparsed_parts: null,
                    source: null,
                    qc: null,
                },
                value: address,
                unrestricted_value: address,
            },
        }

        this.addressKeysToSearchResultsMapping.set(addressKey, searchResult)
        addressSources.forEach((source) => this.addressSourcesToAddressKeyMapping.set(source, addressKey))

        return { ...searchResult, unitType, unitName }
    }

    /**
     *
     * @param params
     * @return {Promise<{ addresses: Object<addressKey: string, address: AddressData>, map: Object<addressSource: string, {err: string, data: Object<addressKey: string, ?unitType: string, ?unitName: string>}> }>}
     */
    async bulkSearch (params = {}) {
        const { items = [] } = params
        const foundResults = await Promise.all(items.flatMap(async (houseAddress) => {
            return { houseAddress: await this.search(houseAddress) }
        }))

        const map = foundResults.reduce((map, foundResult) => {
            const { houseAddress: { address, addressKey, addressSources } } = foundResult

            return {
                ...map,
                ...addressSources.reduce((parts, source) => ({ ...parts, [source]: { data: { addressKey } } }), {}),
            }
        }, {})

        const addresses = Object.fromEntries(foundResults.map(({
            houseAddress: {
                address,
                addressKey,
            },
        }) => ([addressKey, { address }])))
        return { map, addresses }
    }
}

module.exports = { FakeAddressServiceClient, splitAddress }
