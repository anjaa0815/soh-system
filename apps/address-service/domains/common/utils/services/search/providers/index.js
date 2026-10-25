const { ChainedSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/ChainedSearchProvider')
const { DadataSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/DadataSearchProvider')
const { GoogleSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/GoogleSearchProvider')
const { PullentiSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/PullentiSearchProvider')
const { ZipcodeMnSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/ZipcodeMnSearchProvider')

module.exports = {
    ChainedSearchProvider,
    DadataSearchProvider,
    GoogleSearchProvider,
    PullentiSearchProvider,
    ZipcodeMnSearchProvider,
}
