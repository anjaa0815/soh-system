/**
 * Browser-safe description of the payment providers: what they are called and which
 * settings an organization has to fill in.
 *
 * This file is imported by pages (the acquiring settings screen), so it must stay pure
 * data — no `require` of anything server-side. The adapters themselves (qpay.js, byl.js,
 * bonum.js) talk to the providers' APIs and may use Node-only modules (`crypto`,
 * `@open-condo/keystone/fetch`); importing those from a page breaks the webpack build.
 */

const QPAY = {
    slug: 'qpay',
    name: 'QPay',
    configFields: [
        { name: 'merchantId', labelId: 'acquiring.provider.qpay.field.merchantId', type: 'text', required: true },
        { name: 'username', labelId: 'acquiring.provider.qpay.field.username', type: 'text', required: true },
        { name: 'password', labelId: 'acquiring.provider.qpay.field.password', type: 'password', required: true },
        { name: 'invoiceCode', labelId: 'acquiring.provider.qpay.field.invoiceCode', type: 'text', required: true },
    ],
}

const BONUM = {
    slug: 'bonum',
    name: 'Bonum',
    configFields: [
        { name: 'secretKey', labelId: 'acquiring.provider.bonum.field.secretKey', type: 'password', required: true },
    ],
}

const BYL = {
    slug: 'byl',
    name: 'byl.mn',
    configFields: [
        { name: 'projectId', labelId: 'acquiring.provider.byl.field.projectId', type: 'text', required: true },
        { name: 'apiKey', labelId: 'acquiring.provider.byl.field.apiKey', type: 'password', required: true },
        { name: 'webhookSecret', labelId: 'acquiring.provider.byl.field.webhookSecret', type: 'password', required: true },
    ],
}

const PROVIDERS_META = [QPAY, BONUM, BYL]

function getProviderMetaBySlug (slug) {
    return PROVIDERS_META.find((provider) => provider.slug === slug) || null
}

module.exports = {
    QPAY,
    BONUM,
    BYL,
    PROVIDERS_META,
    getProviderMetaBySlug,
}
