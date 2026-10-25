const isNumber = require('lodash/isNumber')
const isString = require('lodash/isString')

const { RUSSIA_COUNTRY, SPAIN_COUNTRY, MONGOLIA_COUNTRY } = require('@condo/domains/common/constants/countries')

// Digits for Ru tin checksum calculation
const RU_TIN_DIGITS = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
const RU_ORGANIZATION_TIN_REGEXP = /^\d{10}$/
const RU_PERSONAL_TIN_REGEXP = /^\d{12}$/

const getTinChecksumRU = num => {
    const n = RU_TIN_DIGITS.slice(-num.length)
    let sum = 0

    for (let i = 0; i < num.length; i++) sum += num[i] * n[i]

    return sum % 11 % 10
}

const validateTinRU = tinValue => {
    if (!isString(tinValue) && !isNumber(tinValue)) return false

    const inn = tinValue.toString().trim()

    if (!RU_ORGANIZATION_TIN_REGEXP.test(inn) && !RU_PERSONAL_TIN_REGEXP.test(inn)) return false
    if (inn.length == 10) return getTinChecksumRU(inn) == inn.slice(-1)
    if (inn.length == 12) return getTinChecksumRU(inn.slice(0, 11)) == inn.slice(10, -1) && getTinChecksumRU(inn) == inn.slice(-1)

    return false
}

const validateTinES = tinValue => {
    const nifRegex = /^[A-Za-z]\d{7}[A-Za-z0-9]$/
    return nifRegex.test(tinValue)
}

// Mongolian legal entity state registration number (улсын бүртгэлийн дугаар) is a 7-digit numeric code
// issued by the General Authority for State Registration. Confirm against the latest official spec
// before relying on this for production use.
const MN_ORGANIZATION_TIN_REGEXP = /^\d{7}$/

const validateTinMN = tinValue => {
    if (!isString(tinValue) && !isNumber(tinValue)) return false

    const tin = tinValue.toString().trim()

    return MN_ORGANIZATION_TIN_REGEXP.test(tin)
}

const isValidTin = (tinValue = null, country = RUSSIA_COUNTRY) => {
    if (country === RUSSIA_COUNTRY) return validateTinRU(tinValue)
    if (country === SPAIN_COUNTRY) return validateTinES(tinValue)
    if (country === MONGOLIA_COUNTRY) return validateTinMN(tinValue)
    // TODO: DOMA-663 add tin validations for countries other than Russian Federation, Spain and Mongolia
    return true
}

const getIsValidTin = (country = RUSSIA_COUNTRY) => (tinValue = null) => isValidTin(tinValue, country)


module.exports = {
    validateTinRU,
    validateTinMN,
    isValidTin,
    getIsValidTin,
}
