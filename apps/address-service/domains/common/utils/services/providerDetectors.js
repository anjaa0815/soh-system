const get = require('lodash/get')

const conf = require('@open-condo/config')
const { getLogger } = require('@open-condo/keystone/logging')

const { DADATA_PROVIDER, GOOGLE_PROVIDER, PULLENTI_PROVIDER, ZIPCODE_MN_PROVIDER } = require('@address-service/domains/common/constants/providers')
const {
    ChainedSearchProvider,
    DadataSearchProvider,
    GoogleSearchProvider,
    PullentiSearchProvider,
    ZipcodeMnSearchProvider,
} = require('@address-service/domains/common/utils/services/search/providers')
const {
    GoogleSuggestionProvider,
    DadataSuggestionProvider,
    PullentiSuggestionProvider,
} = require('@address-service/domains/common/utils/services/suggest/providers')


/**
 * @typedef {Object} ProviderDetectorArgs
 * @property {IncomingMessage & {id: String}} [req] Express request object
 * @property {string} [provider] Explicit provider name (or comma-separated names for a fallback
 * chain, e.g. "zipcode_mn,google"), takes priority over req and conf
 */

/**
 * @param {string} name
 * @param {ProviderDetectorArgs} args
 * @returns {AbstractSearchProvider|undefined}
 */
function instantiateSearchProvider (name, args) {
    switch (name) {
        case DADATA_PROVIDER:
            return new DadataSearchProvider(args)
        case GOOGLE_PROVIDER:
            return new GoogleSearchProvider(args)
        case PULLENTI_PROVIDER:
            return new PullentiSearchProvider(args)
        case ZIPCODE_MN_PROVIDER:
            return new ZipcodeMnSearchProvider(args)
        default:
            return undefined
    }
}

/**
 * @param {ProviderDetectorArgs} args
 * @returns {AbstractSearchProvider|undefined}
 */
function getSearchProvider (args) {
    const providerConf = args?.provider || args?.req?.query?.provider || args?.req?.body?.provider || get(conf, 'PROVIDER')
    const names = String(providerConf || '').split(',').map((name) => name.trim()).filter(Boolean)

    if (names.length === 0) return undefined

    if (names.length === 1) {
        return instantiateSearchProvider(names[0], args)
    }

    const providers = names
        .map((name) => {
            try {
                return instantiateSearchProvider(name, args)
            } catch (err) {
                getLogger('providerDetectors').warn({ msg: 'skipping misconfigured provider in chain', name, err })
                return undefined
            }
        })
        .filter(Boolean)

    if (providers.length === 0) return undefined
    if (providers.length === 1) return providers[0]

    return new ChainedSearchProvider(args, providers)
}

/**
 * @param {ProviderDetectorArgs} args
 * @returns {AbstractSuggestionProvider|undefined}
 */
function getSuggestionsProvider (args) {
    const provider = args?.req?.query?.provider || args?.req?.body?.provider || get(conf, 'PROVIDER')

    /** @type {AbstractSuggestionProvider|undefined} */
    let suggestionProvider

    switch (provider) {
        case GOOGLE_PROVIDER:
            suggestionProvider = new GoogleSuggestionProvider(args)
            break
        case DADATA_PROVIDER:
            suggestionProvider = new DadataSuggestionProvider(args)
            break
        case PULLENTI_PROVIDER:
            suggestionProvider = new PullentiSuggestionProvider(args)
            break
    }

    return suggestionProvider
}

module.exports = { getSearchProvider, getSuggestionsProvider }
