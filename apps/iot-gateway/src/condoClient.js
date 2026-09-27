const { GraphQLClient, gql } = require('graphql-request')

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
}

module.exports = { CondoClient }
