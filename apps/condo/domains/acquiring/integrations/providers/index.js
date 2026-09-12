const bonum = require('./bonum')
const byl = require('./byl')
const qpay = require('./qpay')

const PROVIDERS = [qpay, bonum, byl]

function getProviderBySlug (slug) {
    return PROVIDERS.find((provider) => provider.slug === slug) || null
}

module.exports = {
    PROVIDERS,
    getProviderBySlug,
}
