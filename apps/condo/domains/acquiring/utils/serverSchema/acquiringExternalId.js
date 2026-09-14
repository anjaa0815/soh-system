/**
 * Some providers (QPay confirmed, per its real API - `payment/check` expects `object_id` to be
 * QPay's OWN invoice id, not the merchant's `sender_invoice_no`) require their own externalId to
 * check a payment's status later, but nothing on the Payment/MultiPayment schema has a field for
 * it and adding one needs a schema migration this codebase can't safely generate right now. Redis
 * (already used everywhere else in this app - see @open-condo/keystone/kv) is used as a stopgap:
 * short-lived enough for a checkout session, no schema change required.
 */

const EXTERNAL_ID_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days - generous for an unpaid invoice to still be checked

function getAcquiringExternalIdKey (multiPaymentId) {
    return `acquiring:externalId:${multiPaymentId}`
}

module.exports = {
    getAcquiringExternalIdKey,
    EXTERNAL_ID_TTL_SECONDS,
}
