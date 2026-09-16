/**
 * byl.mn adapter - STUB.
 *
 * We only know, from the user's own example, that byl.mn sends a webhook to
 * `POST /webhooks/{signed-path}` shaped like:
 *   { type: 'checkout.completed', data: { id, amount_total, status } }
 * The `bylsigned` path segment suggests the webhook itself carries or requires a
 * signature, but the exact mechanism (header vs. path token, HMAC algorithm) is unknown.
 *
 * To finish this adapter, get from byl.mn:
 *  - The checkout/invoice creation API (endpoint, auth method, request/response body)
 *  - How to verify a webhook is genuinely from byl.mn (header name + secret + algorithm)
 *  - Whether one byl.mn account can serve multiple organizations ("projects" in their
 *    pricing page), or each organization needs its own account/API key
 */

const slug = 'byl'
const name = 'byl.mn'

const configFields = [
    { name: 'apiKey', labelId: 'acquiring.provider.byl.field.apiKey', type: 'password', required: true },
    { name: 'webhookSecret', labelId: 'acquiring.provider.byl.field.webhookSecret', type: 'password', required: true },
]

async function createPayment () {
    throw new Error('byl.mn adapter is not implemented yet: checkout-creation API shape is unknown, see comment at the top of this file')
}

function verifyWebhookSignature () {
    throw new Error('byl.mn adapter is not implemented yet: webhook signature scheme is unknown, see comment at the top of this file')
}

function parseWebhookEvent (body) {
    return {
        externalId: body?.data?.id ?? null,
        isPaid: body?.type === 'checkout.completed' && body?.data?.status === 'complete',
    }
}

module.exports = {
    slug,
    name,
    configFields,
    createPayment,
    verifyWebhookSignature,
    parseWebhookEvent,
}
