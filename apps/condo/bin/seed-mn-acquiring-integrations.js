/**
 * Idempotently creates (or updates) the three built-in acquiring providers (QPay, Bonum, byl.mn)
 * as AcquiringIntegration rows, so an org admin can pick one on /settings/acquiring. Without this,
 * that page finds zero integrations to offer and silently does nothing when an admin tries to save
 * a provider's settings (see AcquiringSettingsPage.handleSubmit's `if (!integration) return`).
 *
 * Run once per environment: `node bin/seed-mn-acquiring-integrations.js` from apps/condo.
 *
 * Why this exists instead of just calling bin/create-acquiring-integration.js directly: that
 * script requires the caller to already know AcquiringIntegration's required `hostUrl` field and
 * that `supportedBillingIntegrationsGroup` needs an EXISTING BillingIntegration with a matching
 * `group` (a validateInput hook on AcquiringIntegration.js checks this) - calling it without both
 * fails with a generic "invalid mutation" error that doesn't explain why. This script fills in the
 * right values for our own providers and checks that prerequisite explicitly instead of failing
 * silently.
 */
const path = require('path')

const conf = require('@open-condo/config')
const { prepareKeystoneExpressApp } = require('@open-condo/keystone/prepareKeystoneApp')

const { ACQUIRING_INTEGRATION_ONLINE_PROCESSING_TYPE } = require('@condo/domains/acquiring/constants/integration')
const { PROVIDERS } = require('@condo/domains/acquiring/integrations/providers')
const { AcquiringIntegration } = require('@condo/domains/acquiring/utils/serverSchema')
const { DEFAULT_BILLING_INTEGRATION_GROUP } = require('@condo/domains/billing/constants/constants')
const { BillingIntegration } = require('@condo/domains/billing/utils/serverSchema')

const dv = 1
const sender = { dv: 1, fingerprint: 'seed-mn-acquiring-integrations' }

async function main () {
    const { keystone: context } = await prepareKeystoneExpressApp(path.resolve('./index.js'), { excludeApps: ['NextApp', 'AdminUIApp'] })

    const matchingBillingIntegrations = await BillingIntegration.getAll(context, { group: DEFAULT_BILLING_INTEGRATION_GROUP, deletedAt: null }, 'id', { first: 1 })
    if (matchingBillingIntegrations.length === 0) {
        throw new Error(
            `No BillingIntegration with group="${DEFAULT_BILLING_INTEGRATION_GROUP}" exists yet. ` +
            'AcquiringIntegration.supportedBillingIntegrationsGroup requires one to already exist ' +
            '(see AcquiringIntegration.js\'s validateInput hook on that field) - create at least one ' +
            'BillingIntegration with that group first, then re-run this script.'
        )
    }

    for (const provider of PROVIDERS) {
        console.info(`Provider: ${provider.name} (${provider.slug})`)
        const existing = await AcquiringIntegration.getOne(context, { name: provider.name, deletedAt: null }, 'id')

        const payload = {
            dv,
            sender,
            hostUrl: conf.SERVER_URL,
            type: ACQUIRING_INTEGRATION_ONLINE_PROCESSING_TYPE,
            supportedBillingIntegrationsGroup: DEFAULT_BILLING_INTEGRATION_GROUP,
        }

        if (existing) {
            await AcquiringIntegration.update(context, existing.id, payload, 'id')
            console.info(`  updated (${existing.id})`)
        } else {
            const created = await AcquiringIntegration.create(context, { ...payload, name: provider.name }, 'id')
            console.info(`  created (${created.id})`)
        }
    }
}

main().then(
    () => process.exit(),
    (error) => {
        console.error(error)
        process.exit(1)
    },
)
