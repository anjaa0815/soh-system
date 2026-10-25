const get = require('lodash/get')

const { throwAuthenticationError } = require('@open-condo/keystone/apolloErrorFormatter')

const { checkPermissionsInEmployedOrganizations } = require('@condo/domains/organization/utils/accessSchema')

/**
 * Monthly charges (tariffs and receipts generation) can be managed by employees
 * who can manage the organization's integrations
 */
async function canManageMonthlyCharges ({ authentication: { item: user }, args, context }) {
    if (!user) return throwAuthenticationError()
    if (user.deletedAt) return false
    if (user.isAdmin) return true

    const organizationId = get(args, ['data', 'organization', 'id'])
    if (!organizationId) return false

    return await checkPermissionsInEmployedOrganizations(context, user, organizationId, 'canManageIntegrations')
}

module.exports = {
    canManageMonthlyCharges,
}
