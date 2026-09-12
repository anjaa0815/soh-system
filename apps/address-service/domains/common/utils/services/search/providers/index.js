const { DadataSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/DadataSearchProvider')
const { GoogleSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/GoogleSearchProvider')
const { PullentiSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/PullentiSearchProvider')
const { ZipcodeMnSearchProvider } = require('@address-service/domains/common/utils/services/search/providers/ZipcodeMnSearchProvider')

module.exports = {
    DadataSearchProvider,
    GoogleSearchProvider,
    PullentiSearchProvider,
    ZipcodeMnSearchProvider,
}
