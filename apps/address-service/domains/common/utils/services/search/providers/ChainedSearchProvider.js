const { AbstractSearchProvider } = require('./AbstractSearchProvider')

/**
 * Tries a list of search providers in order and uses the first one that returns any results.
 * Lets you put a free/precise provider first (e.g. zipcode_mn for Ulaanbaatar buildings) and
 * fall back to a broader, possibly paid one (e.g. google) only for addresses the first provider
 * doesn't know about - which is what keeps a paid provider's usage (and bill) close to zero
 * when the free provider already covers most real lookups.
 *
 * `normalize()`/`extractHeuristics()` always delegate to whichever provider actually produced
 * the data passed to `get()`, so the rest of the search pipeline doesn't need to know a chain is
 * involved at all.
 */
class ChainedSearchProvider extends AbstractSearchProvider {

    /**
     * @param {ProviderDetectorArgs} args
     * @param {AbstractSearchProvider[]} providers Tried in the given order
     */
    constructor (args, providers) {
        super(args)
        this.providers = providers
        this.lastUsedProvider = null
    }

    getProviderName () {
        return this.lastUsedProvider ? this.lastUsedProvider.getProviderName() : 'chained'
    }

    /**
     * @returns {Promise<Array>}
     */
    async get ({ query, context = null, helpers = {} }) {
        for (const provider of this.providers) {
            let result
            try {
                result = await provider.get({ query, context, helpers })
            } catch (err) {
                this.logger.error({ msg: 'chained provider failed, trying next', provider: provider.getProviderName(), err })
                continue
            }

            if (Array.isArray(result) && result.length > 0) {
                this.lastUsedProvider = provider
                return result
            }
        }

        return []
    }

    normalize (data) {
        if (!this.lastUsedProvider) {
            throw new Error('ChainedSearchProvider.normalize() called before a successful get()')
        }
        return this.lastUsedProvider.normalize(data)
    }

    extractHeuristics (normalizedBuilding) {
        if (!this.lastUsedProvider) {
            throw new Error('ChainedSearchProvider.extractHeuristics() called before a successful get()')
        }
        return this.lastUsedProvider.extractHeuristics(normalizedBuilding)
    }
}

module.exports = { ChainedSearchProvider }
