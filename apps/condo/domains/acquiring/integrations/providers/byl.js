/**
 * byl.mn adapter. Docs: https://byl.mn/docs/api/invoices.html, https://byl.mn/docs/webhook.html
 *
 * A payment is a byl invoice (POST /v1/projects/:project_id/invoices): its `url` is the byl page where
 * the resident picks a payment method (QPay, bank apps, cards) and pays.
 *
 * byl does not take a callback URL per invoice: webhooks go to the endpoint registered in the byl
 * dashboard (one per project), so they are received by the fixed route
 * `/api/webhooks/acquiring/byl` (see AcquiringWebhookMiddleware). The webhook body is signed
 * (`Byl-Signature` = hex HMAC-SHA256 of the raw body with the endpoint's signing secret), but the
 * paid status is still confirmed with GET /v1/projects/:project_id/invoices/:id before a payment is
 * marked as done.
 */
const crypto = require('crypto')

const conf = require('@open-condo/config')
const { fetch } = require('@open-condo/keystone/fetch')

const BYL_API_URL = conf.BYL_API_URL || 'https://byl.mn/api/v1'
const PAID_STATUS = 'paid'
// byl expects due_date in the future, an unpaid invoice stays payable for this long
const INVOICE_TTL_IN_MS = 3 * 24 * 60 * 60 * 1000

const { slug, name, configFields } = require('./meta').BYL

function getInvoicesUrl (settings) {
    return `${BYL_API_URL}/projects/${encodeURIComponent(String(settings.projectId).trim())}/invoices`
}

function getHeaders (settings) {
    return {
        'Authorization': `Bearer ${String(settings.apiKey).trim()}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
}

/**
 * Creates a byl invoice and returns its page url, where the resident is redirected to pay
 * @param {object} settings - per-organization byl settings (projectId, apiKey, webhookSecret)
 * @param {{ amount: string, description: string, orderId: string }} params
 */
async function createPayment (settings, { amount, description, orderId }) {
    const res = await fetch(getInvoicesUrl(settings), {
        method: 'POST',
        headers: getHeaders(settings),
        body: JSON.stringify({
            amount: Number(amount),
            description: String(description).slice(0, 255),
            client_reference_id: orderId,
            due_date: new Date(Date.now() + INVOICE_TTL_IN_MS).toISOString(),
            auto_advance: true,
        }),
    })

    if (!res.ok) {
        throw new Error(`byl invoice creation failed: ${res.status} ${await res.text()}`)
    }

    const { data } = await res.json()

    return {
        externalId: data.id,
        paymentUrl: data.url,
    }
}

/**
 * Server-to-server check of the invoice status, the only source of truth for "is it paid"
 * @param {object} settings
 * @param {string} externalId - byl invoice id
 */
async function checkPaymentStatus (settings, externalId) {
    const res = await fetch(`${getInvoicesUrl(settings)}/${encodeURIComponent(externalId)}`, {
        method: 'GET',
        headers: getHeaders(settings),
    })

    if (!res.ok) {
        throw new Error(`byl invoice check failed: ${res.status} ${await res.text()}`)
    }

    const { data } = await res.json()

    return { isPaid: data.status === PAID_STATUS, raw: data }
}

/**
 * @param {{ rawBody?: Buffer, headers: object }} req - express request, rawBody is kept by the json parser
 * @param {object} settings
 */
function verifyWebhookSignature (req, settings) {
    const secret = settings && settings.webhookSecret
    const signature = req.headers['byl-signature']
    if (!secret || !signature || !req.rawBody) return false

    const computed = crypto.createHmac('sha256', String(secret).trim()).update(req.rawBody).digest('hex')
    const computedBuffer = Buffer.from(computed)
    const signatureBuffer = Buffer.from(String(signature))

    return computedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(computedBuffer, signatureBuffer)
}

/**
 * @returns {{ type: string | null, externalId: number | null, orderId: string | null }}
 */
function parseWebhookEvent (body) {
    const object = (body && body.data && body.data.object) || {}
    return {
        type: (body && body.type) || null,
        externalId: object.id || null,
        orderId: object.client_reference_id || null,
    }
}

module.exports = {
    slug,
    name,
    configFields,
    createPayment,
    checkPaymentStatus,
    verifyWebhookSignature,
    parseWebhookEvent,
}
