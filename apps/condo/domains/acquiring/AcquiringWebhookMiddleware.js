const express = require('express')

const { getKVClient } = require('@open-condo/keystone/kv')
const { getLogger } = require('@open-condo/keystone/logging')
const { getById, find, getSchemaCtx } = require('@open-condo/keystone/schema')

const { PAYMENT_DONE_STATUS } = require('@condo/domains/acquiring/constants/payment')
const { getProviderBySlug } = require('@condo/domains/acquiring/integrations/providers')
const { Payment } = require('@condo/domains/acquiring/utils/serverSchema')
const { getAcquiringExternalIdKey } = require('@condo/domains/acquiring/utils/serverSchema/acquiringExternalId')

const logger = getLogger('acquiringWebhookHandler')
const sender = { dv: 1, fingerprint: 'acquiring-webhook-handler' }

/**
 * Receives payment-completion callbacks from whichever acquiring provider an organization has
 * configured (see domains/acquiring/integrations/providers) and marks the matching Payment done.
 *
 * The multiPaymentId is baked into the callback URL itself (not the webhook body) - see
 * CreateAcquiringPaymentDetailsService's callbackUrl - so this works even for providers whose
 * webhook payload shape we don't fully trust or know.
 *
 * The webhook BODY is never trusted for the "is it actually paid" answer: for a provider that
 * exposes a status-check endpoint (currently only QPay), that server-to-server call is the only
 * source of truth, exactly as documented in providers/qpay.js. A provider without one would need
 * its own verified webhook signature scheme before this handler could trust its payload at all.
 *
 * This system has no separate billing back-office to resync BillingReceipt.paid afterwards, so
 * this handler updates it directly.
 *
 * Mounted as a Keystone express middleware (not a Next API route) because it uses server-side
 * schema utils, which must not be bundled by Next's webpack.
 */
async function handleAcquiringWebhook (req, res) {
    const { slug: providerSlug, multiPaymentId: paymentGroupId } = req.params

    const provider = getProviderBySlug(providerSlug)
    if (!provider) {
        logger.warn({ msg: 'unknown provider slug', data: { providerSlug } })
        res.status(404).json({ error: 'Unknown provider' })
        return
    }

    try {
        const payments = await find('Payment', { multiPayment: { id: paymentGroupId }, deletedAt: null })
        const payment = payments[0]
        if (!payment) {
            logger.warn({ msg: 'no Payment found for multiPayment, acknowledging without action', data: { paymentGroupId } })
            res.status(200).json({ ok: true })
            return
        }

        const acquiringContext = await getById('AcquiringIntegrationContext', payment.context)
        if (!acquiringContext) {
            logger.error({ msg: 'no AcquiringIntegrationContext for payment', entityId: payment.id, entity: 'Payment' })
            res.status(200).json({ ok: true })
            return
        }

        let isPaid = false
        if (typeof provider.checkPaymentStatus === 'function') {
            const kv = getKVClient('acquiring-external-id')
            const externalId = await kv.get(getAcquiringExternalIdKey(paymentGroupId))
            if (!externalId) {
                // Can't verify without the provider's own id (e.g. the Redis key expired or was
                // never set) - safer to leave the payment as pending than to guess wrong.
                logger.warn({ msg: 'no stored externalId for multiPayment, cannot verify with provider yet', data: { paymentGroupId } })
                res.status(200).json({ ok: true })
                return
            }
            const status = await provider.checkPaymentStatus(acquiringContext.settings, externalId)
            isPaid = Boolean(status && status.isPaid)
        } else {
            const verified = provider.verifyWebhookSignature(req)
            if (verified) {
                const parsed = provider.parseWebhookEvent(req.body)
                isPaid = Boolean(parsed && parsed.isPaid)
            }
        }

        if (!isPaid) {
            // Not a failure - just nothing to act on yet (still pending, an unrelated event type, etc).
            res.status(200).json({ ok: true })
            return
        }

        const { keystone: context } = getSchemaCtx('Payment')

        if (payment.status !== PAYMENT_DONE_STATUS) {
            await Payment.update(context, payment.id, {
                dv: 1,
                sender,
                status: PAYMENT_DONE_STATUS,
                advancedAt: new Date().toISOString(),
            })
        }

        res.status(200).json({ ok: true })
    } catch (err) {
        logger.error({ msg: 'acquiring webhook handling failed', data: { providerSlug, paymentGroupId }, err })
        // 500 so the provider's own retry mechanism gets a chance to redeliver.
        res.status(500).json({ error: 'Internal error' })
    }
}

class AcquiringWebhookMiddleware {
    async prepareMiddleware () {
        // Server-to-server callback from payment providers: no cookies/session are used, so csrf does not apply
        // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
        const app = express()

        app.post(
            '/api/webhooks/acquiring/:slug/:multiPaymentId',
            express.json(),
            express.urlencoded({ extended: false }),
            handleAcquiringWebhook,
        )

        return app
    }
}

module.exports = {
    AcquiringWebhookMiddleware,
}
