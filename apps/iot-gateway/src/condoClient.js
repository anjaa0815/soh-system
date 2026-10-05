const { GraphQLClient, gql } = require('graphql-request')

const { parsePlatesValue } = require('./parking/plates')

const REGISTER_METERS_READINGS = gql`
    mutation registerMetersReadings($data: RegisterMetersReadingsInput!) {
        result: registerMetersReadings(data: $data) {
            id
            meter { id number }
        }
    }
`

const REGISTER_PROPERTY_METERS_READINGS = gql`
    mutation registerPropertyMetersReadings($data: RegisterPropertyMetersReadingsInput!) {
        result: registerPropertyMetersReadings(data: $data) {
            id
            meter { id number }
        }
    }
`

const ALL_CUSTOM_VALUES = gql`
    query allCustomValues($where: CustomValueWhereInput!, $first: Int!, $skip: Int!) {
        items: allCustomValues(where: $where, first: $first, skip: $skip, sortBy: [createdAt_ASC]) {
            id
            objectId
            data
        }
    }
`

const ALL_CONTACTS = gql`
    query allContacts($where: ContactWhereInput!, $first: Int!) {
        items: allContacts(where: $where, first: $first) {
            id
            name
            phone
            unitName
            unitType
            property { id address }
        }
    }
`

const CREATE_CUSTOM_VALUE = gql`
    mutation createCustomValue($data: CustomValueCreateInput!) {
        result: createCustomValue(data: $data) { id }
    }
`

const UPDATE_CUSTOM_VALUE = gql`
    mutation updateCustomValue($id: ID!, $data: CustomValueUpdateInput!) {
        result: updateCustomValue(id: $id, data: $data) { id }
    }
`

const PAGE_SIZE = 100

const SENDER = { dv: 1, fingerprint: 'iot-gateway' }

class CondoClient {
    /**
     * @param {Object} options
     * @param {string} options.apiUrl - condo's GraphQL endpoint, e.g. http://localhost:4002/admin/api
     * @param {string} options.serviceToken - a B2BAccessToken value, sent as a Bearer token
     * @param {string} options.organizationId - the Organization this gateway reports data for
     */
    constructor ({ apiUrl, serviceToken, organizationId }) {
        if (!apiUrl) throw new Error('CondoClient: "apiUrl" is required')
        if (!serviceToken) throw new Error('CondoClient: "serviceToken" is required — create one via B2BAccessToken in condo')
        if (!organizationId) throw new Error('CondoClient: "organizationId" is required')

        this.organizationId = organizationId
        this.client = new GraphQLClient(apiUrl, {
            headers: { Authorization: `Bearer ${serviceToken}` },
        })
    }

    /**
     * @param {import('./normalizers/toMeterReading').RawReading[]} readings
     */
    async registerMeterReadings (readingInputs) {
        if (readingInputs.length === 0) return []

        const data = await this.client.request(REGISTER_METERS_READINGS, {
            data: {
                dv: 1,
                sender: SENDER,
                organization: { id: this.organizationId },
                readings: readingInputs,
            },
        })

        return data.result
    }

    /**
     * Registers readings for whole-building meters — common-area electricity/water
     * the HOA itself pays for, not tied to any resident's billing account.
     * @param {import('./normalizers/toMeterReading').RawReading[]} readingInputs
     */
    async registerPropertyMeterReadings (readingInputs) {
        if (readingInputs.length === 0) return []

        const data = await this.client.request(REGISTER_PROPERTY_METERS_READINGS, {
            data: {
                dv: 1,
                sender: SENDER,
                organization: { id: this.organizationId },
                readings: readingInputs,
            },
        })

        return data.result
    }

    async _allPages (query, where) {
        const items = []
        for (let skip = 0; skip < 100000; skip += PAGE_SIZE) {
            const data = await this.client.request(query, { where, first: PAGE_SIZE, skip })
            items.push(...data.items)
            if (data.items.length < PAGE_SIZE) break
        }
        return items
    }

    /**
     * Reads resident vehicles from condo. There is no vehicle model in condo, so plates
     * live in a CustomField on the Contact model (see README.md, "Parking"): each
     * CustomValue holds the plates of one contact.
     * @param {string} platesCustomFieldId
     * @returns {Promise<Array<{plate: string, validUntil: string|null, contact: Object}>>}
     */
    async getVehicleRegistrations (platesCustomFieldId) {
        const values = await this._allPages(ALL_CUSTOM_VALUES, {
            customField: { id: platesCustomFieldId },
            organization: { id: this.organizationId },
            deletedAt: null,
        })

        const contactsById = new Map()
        const contactIds = [...new Set(values.map((value) => value.objectId))]
        for (let i = 0; i < contactIds.length; i += PAGE_SIZE) {
            const data = await this.client.request(ALL_CONTACTS, {
                where: { id_in: contactIds.slice(i, i + PAGE_SIZE), deletedAt: null },
                first: PAGE_SIZE,
            })
            for (const contact of data.items) {
                contactsById.set(contact.id, {
                    id: contact.id,
                    name: contact.name,
                    phone: contact.phone,
                    unitName: contact.unitName,
                    unitType: contact.unitType,
                    propertyAddress: contact.property ? contact.property.address : '',
                })
            }
        }

        const vehicles = []
        for (const value of values) {
            const contact = contactsById.get(value.objectId)
            if (!contact) continue   // contact was deleted -> its plates lose access
            for (const { plate, validUntil } of parsePlatesValue(value.data)) {
                vehicles.push({ plate, validUntil, contact })
            }
        }
        return vehicles
    }

    /**
     * Creates or replaces the CustomValue of `customFieldId` on one condo object.
     * @param {Object} params
     * @param {string} params.customFieldId
     * @param {string} params.objectId - id of the Contact the value belongs to
     * @param {*} params.data
     * @param {string} params.b2bAppId - the B2BApp this gateway's service user belongs to
     */
    async upsertCustomValue ({ customFieldId, objectId, data, b2bAppId }) {
        if (!b2bAppId) throw new Error('CondoClient: "b2bAppId" is required to write CustomValues')
        const source = { sourceType: 'B2BApp', sourceId: b2bAppId }
        const existing = await this.client.request(ALL_CUSTOM_VALUES, {
            where: { customField: { id: customFieldId }, organization: { id: this.organizationId }, objectId, deletedAt: null },
            first: 1,
            skip: 0,
        })
        if (existing.items.length > 0) {
            const result = await this.client.request(UPDATE_CUSTOM_VALUE, {
                id: existing.items[0].id,
                data: { dv: 1, sender: SENDER, data, ...source },
            })
            return result.result
        }
        const result = await this.client.request(CREATE_CUSTOM_VALUE, {
            data: {
                dv: 1,
                sender: SENDER,
                customField: { connect: { id: customFieldId } },
                organization: { connect: { id: this.organizationId } },
                objectId,
                data,
                ...source,
            },
        })
        return result.result
    }

    /** Finds one contact of this organization by phone (used by scripts/import-vehicles.js). */
    async findContactsByPhone (phone) {
        const data = await this.client.request(ALL_CONTACTS, {
            where: { phone, organization: { id: this.organizationId }, deletedAt: null },
            first: 10,
        })
        return data.items
    }
}

module.exports = { CondoClient }
