/**
 * QPay adapter.
 *
 * NOTE: field names and endpoint shapes below follow QPay's publicly documented
 * Merchant API v2 (https://developer.qpay.mn) as commonly described, but have NOT been
 * verified against a live QPay merchant account from this codebase. Before accepting
 * real payments, confirm every endpoint/field name against the current QPay docs and
 * a real merchant sandbox.
 */

const QPAY_BASE_URL = 'https://merchant.qpay.mn/v2'

const slug = 'qpay'
const name = 'QPay'

const configFields = [
    { name: 'merchantId', labelId: 'acquiring.provider.qpay.field.merchantId', type: 'text', required: true },
    { name: 'username', labelId: 'acquiring.provider.qpay.field.username', type: 'text', required: true },
    { name: 'password', labelId: 'acquiring.provider.qpay.field.password', type: 'password', required: true },
    { name: 'invoiceCode', labelId: 'acquiring.provider.qpay.field.invoiceCode', type: 'text', required: true },
]

async function getAccessToken (settings) {
    const { username, password } = settings
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64')

    const res = await fetch(`${QPAY_BASE_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basicAuth}` },
    })

    if (!res.ok) {
        throw new Error(`QPay auth failed: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    return data.access_token
}

/**
 * Creates a QPay invoice for a given amount and returns data needed to render a QR code
 * and/or redirect the resident to their banking app.
 * @param {object} settings - per-organization QPay settings (merchantId, username, password, invoiceCode)
 * @param {{ amount: string, description: string, orderId: string, callbackUrl: string }} params
 */
async function createPayment (settings, { amount, description, orderId, callbackUrl }) {
    const accessToken = await getAccessToken(settings)

    const res = await fetch(`${QPAY_BASE_URL}/invoice`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            invoice_code: settings.invoiceCode,
            sender_invoice_no: orderId,
            invoice_receiver_code: 'terminal',
            invoice_description: description,
            amount,
            callback_url: callbackUrl,
        }),
    })

    if (!res.ok) {
        throw new Error(`QPay invoice creation failed: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()

    return {
        externalId: data.invoice_id,
        qrText: data.qr_text,
        qrImageBase64: data.qr_image,
        deepLinks: data.urls || [],
    }
}

/**
 * QPay's callback payload is not treated as trustworthy by itself - the documented
 * integration pattern is to re-check payment status server-to-server after receiving
 * a callback, rather than trust the callback body/signature directly.
 */
async function checkPaymentStatus (settings, externalId) {
    const accessToken = await getAccessToken(settings)

    const res = await fetch(`${QPAY_BASE_URL}/payment/check`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            object_type: 'INVOICE',
            object_id: externalId,
        }),
    })

    if (!res.ok) {
        throw new Error(`QPay payment check failed: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    const rows = data.rows || []
    const isPaid = rows.some((row) => row.payment_status === 'PAID')

    return { isPaid, raw: data }
}

/**
 * QPay does not sign its callback body, so there is nothing to verify here -
 * the callback is only used as a hint to trigger checkPaymentStatus.
 */
function verifyWebhookSignature () {
    return true
}

function parseWebhookEvent (body) {
    return { externalId: body.invoice_id || body.object_id || null }
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
