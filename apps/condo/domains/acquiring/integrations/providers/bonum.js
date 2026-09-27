/**
 * Bonum.Gateway adapter - STUB.
 *
 * We only have Bonum's public marketing page (bonum.mn/gateway), not their API
 * reference. Their sample code shows `require('stripe')(...)`, suggesting a
 * Stripe-SDK-compatible API, but this needs confirming before writing real calls.
 *
 * To finish this adapter, get from Bonum:
 *  - Base API URL and whether the official `stripe` npm package can really be pointed
 *    at it (e.g. via `apiVersion`/`host` options), or whether they expose their own SDK
 *  - The exact payment-creation call (their sample used `bonum.paymentIntents.create`)
 *    and what it returns (redirect URL? QR text?)
 *  - Webhook payload shape and how to verify its signature (Stripe uses a
 *    `Stripe-Signature` header + HMAC; confirm Bonum does the same)
 *  - Whether merchant onboarding is per-organization or platform-wide
 */

const slug = 'bonum'
const name = 'Bonum'

const configFields = [
    { name: 'secretKey', labelId: 'acquiring.provider.bonum.field.secretKey', type: 'password', required: true },
]

async function createPayment () {
    throw new Error('Bonum adapter is not implemented yet: payment-creation API shape is unknown, see comment at the top of this file')
}

function verifyWebhookSignature () {
    throw new Error('Bonum adapter is not implemented yet: webhook signature scheme is unknown, see comment at the top of this file')
}

function parseWebhookEvent () {
    throw new Error('Bonum adapter is not implemented yet: webhook payload shape is unknown, see comment at the top of this file')
}

module.exports = {
    slug,
    name,
    configFields,
    createPayment,
    verifyWebhookSignature,
    parseWebhookEvent,
}
