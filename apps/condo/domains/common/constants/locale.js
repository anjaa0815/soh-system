const EN = require('dayjs/locale/en')
const ES = require('dayjs/locale/es')
const MN = require('dayjs/locale/mn')
const RU = require('dayjs/locale/ru')

const RU_LOCALE = 'ru'
const EN_LOCALE = 'en'
const ES_LOCALE = 'es'
const MN_LOCALE = 'mn'
/** @deprecated don't use this hardcode const! use conf.DEFAULT_LOCALE */
const DEFAULT_LOCALE = RU_LOCALE
const LOCALES = {
    [RU_LOCALE]: RU,
    [EN_LOCALE]: EN,
    [ES_LOCALE]: ES,
    [MN_LOCALE]: MN,
}

// TODO(pahaz): we also have a LANG. We need to check the locale usage and refactor it to locale or lang
module.exports = {
    RU_LOCALE,
    EN_LOCALE,
    ES_LOCALE,
    MN_LOCALE,
    DEFAULT_LOCALE,
    LOCALES,
}
