/**
 * Monthly charges of an organization (e.g. a home owners association) calculated inside condo,
 * without an external billing system:
 * - tariffs are fixed monthly fees per unit, optionally only for one unit type (e.g. parking)
 * - receipts are generated for every unit of every property map for a period
 * - unpaid balance of the previous period receipt is carried over as a separate service line
 *
 * Settings live in the settings of the organization's context of the internal billing integration,
 * receipts are registered with the regular RegisterBillingReceiptsService pipeline,
 * so they show up in the billing pages and can be paid online as any other receipts.
 */
const Big = require('big.js')
const dayjs = require('dayjs')
const get = require('lodash/get')

const conf = require('@open-condo/config')
const { GQLError, GQLErrorCode: { BAD_USER_INPUT } } = require('@open-condo/keystone/errors')
const { getLogger } = require('@open-condo/keystone/logging')
const { find, getById, GQLCustomSchema } = require('@open-condo/keystone/schema')

const { CONTEXT_FINISHED_STATUS: ACQUIRING_CONTEXT_FINISHED_STATUS } = require('@condo/domains/acquiring/constants/context')
const { ACQUIRING_INTEGRATION_EXTERNAL_IMPORT_TYPE } = require('@condo/domains/acquiring/constants/integration')
const { PAYMENT_DONE_STATUS, PAYMENT_ERROR_STATUS } = require('@condo/domains/acquiring/constants/payment')
const { freezeBillingReceipt } = require('@condo/domains/acquiring/utils/billingFridge')
const { AcquiringIntegration, AcquiringIntegrationContext, Payment } = require('@condo/domains/acquiring/utils/serverSchema')
const access = require('@condo/domains/billing/access/MonthlyChargesService')
const { PERIOD_REGEX, DEFAULT_BILLING_INTEGRATION_GROUP } = require('@condo/domains/billing/constants/constants')
const { RegisterBillingReceiptsService } = require('@condo/domains/billing/schema/RegisterBillingReceiptsService')
const {
    BillingIntegration,
    BillingIntegrationOrganizationContext,
    getNewPaymentsSum,
} = require('@condo/domains/billing/utils/serverSchema')
const { WRONG_VALUE, NOT_FOUND } = require('@condo/domains/common/constants/errors')
const { CONTEXT_FINISHED_STATUS } = require('@condo/domains/miniapp/constants')
const { FLAT_UNIT_TYPE, PARKING_UNIT_TYPE, UNIT_TYPES } = require('@condo/domains/property/constants/common')

const logger = getLogger()

const INTERNAL_BILLING_INTEGRATION_NAME = 'Хөтөч: сарын төлбөр'
const CASH_ACQUIRING_INTEGRATION_NAME = 'Хөтөч: бэлэн мөнгө'
const PREVIOUS_BALANCE_SERVICE_NAME = 'Өмнөх сарын үлдэгдэл'
const MAX_TARIFFS = 50
const REGISTER_CHUNK_SIZE = 500
const DV_SENDER = { dv: 1, sender: { dv: 1, fingerprint: 'monthly-charges-service' } }

const ERRORS = {
    NO_TARIFFS: {
        mutation: 'generateMonthlyBillingReceipts',
        code: BAD_USER_INPUT,
        type: NOT_FOUND,
        message: 'No monthly tariffs are set up for the organization',
        messageForUser: 'api.billing.monthlyCharges.NO_TARIFFS',
    },
    NO_UNITS: {
        mutation: 'generateMonthlyBillingReceipts',
        code: BAD_USER_INPUT,
        type: NOT_FOUND,
        message: 'Organization has no properties with units on the property map',
        messageForUser: 'api.billing.monthlyCharges.NO_UNITS',
    },
    BAD_PERIOD: {
        mutation: 'generateMonthlyBillingReceipts',
        variable: ['data', 'period'],
        code: BAD_USER_INPUT,
        type: WRONG_VALUE,
        message: 'Bad period format, must be YYYY-MM-01',
    },
    INVALID_TARIFF: {
        mutation: 'saveMonthlyChargesSettings',
        variable: ['data', 'tariffs'],
        code: BAD_USER_INPUT,
        type: WRONG_VALUE,
        message: 'Every tariff must have a name, a positive amount and a known unit type',
        messageForUser: 'api.billing.monthlyCharges.INVALID_TARIFF',
    },
    NO_BANK_ACCOUNT: {
        mutation: 'saveMonthlyChargesSettings',
        variable: ['data', 'bankAccount'],
        code: BAD_USER_INPUT,
        type: WRONG_VALUE,
        message: 'Bank account is required',
        messageForUser: 'api.billing.monthlyCharges.NO_BANK_ACCOUNT',
    },
    RECEIPT_NOT_FOUND: {
        mutation: 'registerCashPayment',
        variable: ['data', 'receipt'],
        code: BAD_USER_INPUT,
        type: NOT_FOUND,
        message: 'Receipt of the organization monthly charges is not found',
        messageForUser: 'api.billing.monthlyCharges.RECEIPT_NOT_FOUND',
    },
    INVALID_AMOUNT: {
        mutation: 'registerCashPayment',
        variable: ['data', 'amount'],
        code: BAD_USER_INPUT,
        type: WRONG_VALUE,
        message: 'Amount must be a number greater than 0',
        messageForUser: 'api.billing.monthlyCharges.INVALID_AMOUNT',
    },
    PAYMENT_NOT_FOUND: {
        mutation: 'cancelCashPayment',
        variable: ['data', 'payment'],
        code: BAD_USER_INPUT,
        type: NOT_FOUND,
        message: 'Cash payment of the organization is not found',
        messageForUser: 'api.billing.monthlyCharges.PAYMENT_NOT_FOUND',
    },
    NO_ORGANIZATION_TIN: {
        mutation: 'generateMonthlyBillingReceipts',
        code: BAD_USER_INPUT,
        type: NOT_FOUND,
        message: 'Organization has no TIN, which is required for receipts',
        messageForUser: 'api.billing.monthlyCharges.NO_ORGANIZATION_TIN',
    },
}

async function getInternalIntegration (context) {
    const existing = await BillingIntegration.getOne(context, { name: INTERNAL_BILLING_INTEGRATION_NAME, deletedAt: null }, 'id')
    if (existing) return existing

    return await BillingIntegration.create(context, {
        ...DV_SENDER,
        name: INTERNAL_BILLING_INTEGRATION_NAME,
        shortDescription: 'Сарын тогтмол төлбөрийн нэхэмжлэхийг автоматаар үүсгэнэ',
        detailedDescription: 'Тоот бүрт сарын тогтмол хураамжийн нэхэмжлэх үүсгэж, өмнөх сарын төлөгдөөгүй үлдэгдлийг дараа сард шилжүүлнэ. Оршин суугчид QPay-ээр онлайнаар төлнө.',
        targetDescription: 'СӨХ, удирдлагын компани',
        instruction: 'Тооцоо ба төлбөрүүд → Сарын төлбөр хэсэгт тариф болон дансаа тохируулаад сар бүр нэхэмжлэх үүсгэнэ.',
        receiptsLoadingTime: '1 минут',
        bannerColor: 'linear-gradient(90deg, #4cd174 0%, #6db8f2 100%)',
        bannerTextColor: 'BLACK',
        currencyCode: 'MNT',
        group: DEFAULT_BILLING_INTEGRATION_GROUP,
        isHidden: false,
    }, 'id')
}

async function getOrganizationContext (context, organizationId) {
    return await BillingIntegrationOrganizationContext.getOne(context, {
        organization: { id: organizationId },
        integration: { name: INTERNAL_BILLING_INTEGRATION_NAME },
        deletedAt: null,
    }, 'id settings organization { id tin name }')
}

/**
 * Payments made in cash or by a bank transfer outside of condo are registered in the hidden
 * external import acquiring context of the organization: a payment linked to a receipt needs one
 */
async function getCashAcquiringContext (context, organizationId) {
    let integration = await AcquiringIntegration.getOne(context, { name: CASH_ACQUIRING_INTEGRATION_NAME, deletedAt: null }, 'id')
    if (!integration) {
        integration = await AcquiringIntegration.create(context, {
            ...DV_SENDER,
            name: CASH_ACQUIRING_INTEGRATION_NAME,
            type: ACQUIRING_INTEGRATION_EXTERNAL_IMPORT_TYPE,
            hostUrl: conf.SERVER_URL,
            supportedBillingIntegrationsGroup: DEFAULT_BILLING_INTEGRATION_GROUP,
            canGroupReceipts: false,
            explicitFeeDistributionSchema: [],
            isHidden: true,
        }, 'id')
    }
    const existing = await AcquiringIntegrationContext.getOne(context, {
        organization: { id: organizationId },
        integration: { id: integration.id },
        deletedAt: null,
    }, 'id')
    if (existing) return existing

    return await AcquiringIntegrationContext.create(context, {
        ...DV_SENDER,
        integration: { connect: { id: integration.id } },
        organization: { connect: { id: organizationId } },
        settings: { dv: 1 },
        state: { dv: 1 },
        status: ACQUIRING_CONTEXT_FINISHED_STATUS,
    }, 'id')
}

function parseAmount (value) {
    try {
        return Big(String(value).replace(',', '.').replace(/\s/g, ''))
    } catch {
        return null
    }
}

function getSettings (billingContext) {
    return {
        tariffs: get(billingContext, ['settings', 'monthlyCharges', 'tariffs'], []),
        bankAccount: get(billingContext, ['settings', 'monthlyCharges', 'bankAccount'], null),
        bankName: get(billingContext, ['settings', 'monthlyCharges', 'bankName'], null),
    }
}

/**
 * All units of the property map: sections hold flats by default, parking holds parking places by default
 */
function getPropertyUnits (property) {
    const units = []
    const collect = (sections, defaultUnitType) => {
        for (const section of sections || []) {
            for (const floor of get(section, 'floors', [])) {
                for (const unit of get(floor, 'units', [])) {
                    if (unit && unit.label) units.push({ unitName: String(unit.label).trim(), unitType: unit.unitType || defaultUnitType })
                }
            }
        }
    }
    collect(get(property, ['map', 'sections']), FLAT_UNIT_TYPE)
    collect(get(property, ['map', 'parking']), PARKING_UNIT_TYPE)
    return units
}

/**
 * Stable, human-readable account number: 6 first chars of the property id + unit
 * (non-flat units get a unit type letter so that flat 12 and parking place 12 differ)
 */
function buildAccountNumber (property, { unitName, unitType }) {
    const propertyCode = property.id.replace(/-/g, '').slice(0, 6).toUpperCase()
    const unitTypeCode = unitType === FLAT_UNIT_TYPE ? '' : unitType[0].toUpperCase()
    return `${propertyCode}-${unitTypeCode}${unitName}`
}

function formatMoney (value) {
    return Big(value).toFixed(2)
}

const MonthlyChargesService = new GQLCustomSchema('MonthlyChargesService', {
    types: [
        {
            access: true,
            type: 'input MonthlyChargeTariffInput { id: String!, name: String!, amount: String!, unitType: String }',
        },
        {
            access: true,
            type: 'type MonthlyChargeTariff { id: String!, name: String!, amount: String!, unitType: String }',
        },
        {
            access: true,
            type: 'input GetMonthlyChargesSettingsInput { organization: OrganizationWhereUniqueInput! }',
        },
        {
            access: true,
            type: 'type MonthlyChargesSettingsOutput { tariffs: [MonthlyChargeTariff!]!, bankAccount: String, bankName: String }',
        },
        {
            access: true,
            type: 'input SaveMonthlyChargesSettingsInput { dv: Int!, sender: SenderFieldInput!, organization: OrganizationWhereUniqueInput!, tariffs: [MonthlyChargeTariffInput!]!, bankAccount: String!, bankName: String }',
        },
        {
            access: true,
            type: 'input GenerateMonthlyBillingReceiptsInput { dv: Int!, sender: SenderFieldInput!, organization: OrganizationWhereUniqueInput!, period: String! }',
        },
        {
            access: true,
            type: 'type GenerateMonthlyBillingReceiptsOutput { receiptsCount: Int!, failedCount: Int!, totalToPay: String! }',
        },
        {
            access: true,
            type: 'input GetMonthlyReceiptsInput { organization: OrganizationWhereUniqueInput!, period: String! }',
        },
        {
            access: true,
            type: 'type MonthlyCashPayment { id: ID!, amount: String!, paidAt: String, purpose: String }',
        },
        {
            access: true,
            type: 'type MonthlyReceipt { id: ID!, accountNumber: String!, unitName: String, unitType: String, address: String, toPay: String!, paid: String!, remaining: String!, cashPayments: [MonthlyCashPayment!]! }',
        },
        {
            access: true,
            type: 'input RegisterCashPaymentInput { dv: Int!, sender: SenderFieldInput!, organization: OrganizationWhereUniqueInput!, receipt: BillingReceiptWhereUniqueInput!, amount: String!, paidAt: String, purpose: String }',
        },
        {
            access: true,
            type: 'type CashPaymentOutput { paymentId: ID!, receiptToPay: String!, receiptPaid: String!, receiptRemaining: String! }',
        },
        {
            access: true,
            type: 'input CancelCashPaymentInput { dv: Int!, sender: SenderFieldInput!, organization: OrganizationWhereUniqueInput!, payment: PaymentWhereUniqueInput! }',
        },
    ],
    queries: [
        {
            access: access.canManageMonthlyCharges,
            schema: 'getMonthlyReceipts (data: GetMonthlyReceiptsInput!): [MonthlyReceipt!]',
            resolver: async (parent, args, context) => {
                const { data: { organization, period } } = args
                if (!PERIOD_REGEX.test(period)) throw new GQLError(ERRORS.BAD_PERIOD, context)

                const billingContext = await getOrganizationContext(context, organization.id)
                if (!billingContext) return []
                const receipts = await find('BillingReceipt', { context: { id: billingContext.id }, period, deletedAt: null })
                if (receipts.length === 0) return []

                const receiptIds = receipts.map(({ id }) => id)
                const accounts = await find('BillingAccount', { id_in: [...new Set(receipts.map(({ account }) => account))] })
                const properties = await find('BillingProperty', { id_in: [...new Set(receipts.map(({ property }) => property))] })
                const payments = await find('Payment', { receipt: { id_in: receiptIds }, status_in: [PAYMENT_DONE_STATUS, 'WITHDRAWN'], deletedAt: null })
                const cashContext = await getCashAcquiringContext(context, organization.id)

                const accountsById = Object.fromEntries(accounts.map((account) => [account.id, account]))
                const propertiesById = Object.fromEntries(properties.map((property) => [property.id, property]))
                return receipts.map((receipt) => {
                    const receiptPayments = payments.filter((payment) => payment.receipt === receipt.id)
                    const paid = receiptPayments.reduce((sum, payment) => sum.plus(payment.amount), Big(0))
                    const account = accountsById[receipt.account] || {}
                    return {
                        id: receipt.id,
                        accountNumber: account.number,
                        unitName: account.unitName,
                        unitType: account.unitType,
                        address: get(propertiesById, [receipt.property, 'address']),
                        toPay: formatMoney(receipt.toPay || 0),
                        paid: formatMoney(paid),
                        remaining: formatMoney(Big(receipt.toPay || 0).minus(paid)),
                        cashPayments: receiptPayments
                            .filter((payment) => payment.context === cashContext.id)
                            .map((payment) => ({ id: payment.id, amount: formatMoney(payment.amount), paidAt: payment.advancedAt ? dayjs(payment.advancedAt).toISOString() : null, purpose: payment.purpose })),
                    }
                }).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }))
            },
        },
        {
            access: access.canManageMonthlyCharges,
            schema: 'getMonthlyChargesSettings (data: GetMonthlyChargesSettingsInput!): MonthlyChargesSettingsOutput',
            resolver: async (parent, args, context) => {
                const { data: { organization } } = args
                const billingContext = await getOrganizationContext(context, organization.id)
                return getSettings(billingContext)
            },
        },
    ],
    mutations: [
        {
            access: access.canManageMonthlyCharges,
            schema: 'saveMonthlyChargesSettings (data: SaveMonthlyChargesSettingsInput!): MonthlyChargesSettingsOutput',
            doc: {
                summary: 'Saves monthly tariffs and the bank account receipts are paid to',
                errors: ERRORS,
            },
            resolver: async (parent, args, context) => {
                const { data: { dv, sender, organization, tariffs: tariffsInput, bankAccount, bankName } } = args

                if (!bankAccount || !bankAccount.trim()) throw new GQLError(ERRORS.NO_BANK_ACCOUNT, context)
                if (tariffsInput.length > MAX_TARIFFS) throw new GQLError(ERRORS.INVALID_TARIFF, context)
                const tariffs = []
                for (const { id, name, amount, unitType } of tariffsInput) {
                    let parsedAmount
                    try {
                        parsedAmount = Big(String(amount).replace(',', '.').replace(/\s/g, ''))
                    } catch {
                        throw new GQLError(ERRORS.INVALID_TARIFF, context)
                    }
                    const isValid = id && name && name.trim() && parsedAmount.gt(0) && (!unitType || UNIT_TYPES.includes(unitType))
                    if (!isValid) throw new GQLError(ERRORS.INVALID_TARIFF, context)
                    tariffs.push({ id, name: name.trim(), amount: formatMoney(parsedAmount), unitType: unitType || null })
                }

                const monthlyCharges = { tariffs, bankAccount: bankAccount.trim(), bankName: bankName ? bankName.trim() : null }
                const existingContext = await getOrganizationContext(context, organization.id)
                if (existingContext) {
                    await BillingIntegrationOrganizationContext.update(context, existingContext.id, {
                        dv, sender,
                        settings: { ...existingContext.settings, dv: 1, monthlyCharges },
                    })
                } else {
                    const integration = await getInternalIntegration(context)
                    await BillingIntegrationOrganizationContext.create(context, {
                        dv, sender,
                        integration: { connect: { id: integration.id } },
                        organization: { connect: { id: organization.id } },
                        settings: { dv: 1, monthlyCharges },
                        state: { dv: 1 },
                        status: CONTEXT_FINISHED_STATUS,
                    })
                }

                return monthlyCharges
            },
        },
        {
            access: access.canManageMonthlyCharges,
            schema: 'generateMonthlyBillingReceipts (data: GenerateMonthlyBillingReceiptsInput!): GenerateMonthlyBillingReceiptsOutput',
            doc: {
                summary: 'Creates (or recalculates) receipts of the period for every unit of the organization properties',
                errors: ERRORS,
            },
            resolver: async (parent, args, context) => {
                const { data: { dv, sender, organization, period } } = args
                if (!PERIOD_REGEX.test(period)) throw new GQLError(ERRORS.BAD_PERIOD, context)

                const billingContext = await getOrganizationContext(context, organization.id)
                const { tariffs, bankAccount, bankName } = getSettings(billingContext)
                if (!billingContext || tariffs.length === 0 || !bankAccount) throw new GQLError(ERRORS.NO_TARIFFS, context)
                const tin = get(billingContext, ['organization', 'tin'])
                if (!tin) throw new GQLError(ERRORS.NO_ORGANIZATION_TIN, context)

                const properties = await find('Property', { organization: { id: organization.id }, deletedAt: null })
                const units = properties.flatMap((property) => getPropertyUnits(property).map((unit) => ({
                    ...unit, property, accountNumber: buildAccountNumber(property, unit),
                })))
                if (units.length === 0) throw new GQLError(ERRORS.NO_UNITS, context)

                // The recipient is created by the receipts registration and is approved automatically,
                // as its tin is the tin of the context organization (see BillingRecipient.isApproved)

                // Unpaid balance of the previous period, by account number
                const previousPeriod = dayjs(period).subtract(1, 'month').format('YYYY-MM-01')
                const previousReceipts = await find('BillingReceipt', {
                    context: { id: billingContext.id },
                    period: previousPeriod,
                    deletedAt: null,
                })
                const previousAccounts = previousReceipts.length
                    ? await find('BillingAccount', { id_in: [...new Set(previousReceipts.map(({ account }) => account))] })
                    : []
                const accountNumbersById = Object.fromEntries(previousAccounts.map(({ id, number }) => [id, number]))
                const previousBalances = {}
                for (const receipt of previousReceipts) {
                    // receipt.paid is filled only by external billings, payments made here are summed up instead
                    const paid = await getNewPaymentsSum(receipt.id)
                    previousBalances[accountNumbersById[receipt.account]] = Big(receipt.toPay || 0).minus(Big(paid || 0))
                }

                const [year, month] = period.split('-').map(Number)
                const receiptsInput = units.map(({ property, unitName, unitType, accountNumber }) => {
                    const services = tariffs
                        .filter((tariff) => !tariff.unitType || tariff.unitType === unitType)
                        .map((tariff) => ({ id: tariff.id, name: tariff.name, toPay: tariff.amount }))
                    const previousBalance = previousBalances[accountNumber]
                    if (previousBalance && !previousBalance.eq(0)) {
                        services.push({ id: 'previous-balance', name: PREVIOUS_BALANCE_SERVICE_NAME, toPay: formatMoney(previousBalance) })
                    }
                    const toPay = services.reduce((sum, service) => sum.plus(service.toPay), Big(0))
                    return {
                        importId: `monthly:${period}:${accountNumber}`,
                        address: `${property.address} #key:${property.addressKey}`,
                        addressMeta: { unitName, unitType },
                        accountNumber,
                        toPay: formatMoney(toPay),
                        toPayDetails: { charge: formatMoney(toPay.minus(previousBalance || 0)), balance: formatMoney(previousBalance || 0) },
                        services,
                        month, year,
                        tin, routingNumber: bankName || 'MN', bankAccount,
                        unitName, unitType,
                    }
                }).filter(({ services }) => services.length > 0)

                let receiptsCount = 0
                let failedCount = 0
                let totalToPay = Big(0)
                const registerResolver = RegisterBillingReceiptsService.schema.mutations[0].resolver
                for (let i = 0; i < receiptsInput.length; i += REGISTER_CHUNK_SIZE) {
                    const chunk = receiptsInput.slice(i, i + REGISTER_CHUNK_SIZE)
                    const results = await Promise.allSettled(await registerResolver(parent, {
                        data: { dv, sender, context: { id: billingContext.id }, receipts: chunk },
                    }, context))
                    for (const [index, result] of results.entries()) {
                        if (result.status === 'fulfilled' && result.value) {
                            receiptsCount++
                            totalToPay = totalToPay.plus(chunk[index].toPay)
                        } else {
                            failedCount++
                            logger.warn({ msg: 'monthly receipt was not registered', entityId: billingContext.id, entity: 'BillingIntegrationOrganizationContext', data: { accountNumber: chunk[index].accountNumber, reason: get(result, 'reason.message', result.reason) } })
                        }
                    }
                }

                logger.info({ msg: 'monthly receipts generated', entityId: billingContext.id, entity: 'BillingIntegrationOrganizationContext', count: receiptsCount, data: { period, failedCount } })

                return { receiptsCount, failedCount, totalToPay: formatMoney(totalToPay) }
            },
        },
        {
            access: access.canManageMonthlyCharges,
            schema: 'registerCashPayment (data: RegisterCashPaymentInput!): CashPaymentOutput',
            doc: {
                summary: 'Registers a payment of a monthly charges receipt made in cash or by a bank transfer outside of condo',
                errors: ERRORS,
            },
            resolver: async (parent, args, context) => {
                const { data: { dv, sender, organization, receipt: receiptInput, amount: amountInput, paidAt, purpose } } = args

                const amount = parseAmount(amountInput)
                if (!amount || !amount.gt(0)) throw new GQLError(ERRORS.INVALID_AMOUNT, context)

                const billingContext = await getOrganizationContext(context, organization.id)
                const receipt = billingContext && await getById('BillingReceipt', receiptInput.id)
                if (!receipt || receipt.deletedAt || receipt.context !== billingContext.id) throw new GQLError(ERRORS.RECEIPT_NOT_FOUND, context)

                const account = await getById('BillingAccount', receipt.account)
                const acquiringContext = await getCashAcquiringContext(context, organization.id)
                const payment = await Payment.create(context, {
                    dv, sender,
                    amount: amount.toFixed(2),
                    currencyCode: 'MNT',
                    accountNumber: account.number,
                    period: receipt.period,
                    receipt: { connect: { id: receipt.id } },
                    frozenReceipt: await freezeBillingReceipt(context, receipt),
                    context: { connect: { id: acquiringContext.id } },
                    organization: { connect: { id: organization.id } },
                    recipientBic: get(receipt, ['recipient', 'bic']),
                    recipientBankAccount: get(receipt, ['recipient', 'bankAccount']),
                    purpose: purpose ? purpose.trim() : null,
                    status: PAYMENT_DONE_STATUS,
                    explicitFee: '0',
                    explicitServiceCharge: '0',
                    advancedAt: paidAt ? dayjs(paidAt).toISOString() : new Date().toISOString(),
                }, 'id')

                const paid = Big(await getNewPaymentsSum(receipt.id) || 0)
                const toPay = Big(receipt.toPay || 0)
                logger.info({ msg: 'cash payment registered', entityId: payment.id, entity: 'Payment', data: { receipt: receipt.id, amount: amount.toFixed(2) } })

                return { paymentId: payment.id, receiptToPay: formatMoney(toPay), receiptPaid: formatMoney(paid), receiptRemaining: formatMoney(toPay.minus(paid)) }
            },
        },
        {
            access: access.canManageMonthlyCharges,
            schema: 'cancelCashPayment (data: CancelCashPaymentInput!): CashPaymentOutput',
            doc: {
                summary: 'Cancels a cash payment registered by mistake (moves it to the ERROR status, so it is not counted anymore)',
                errors: ERRORS,
            },
            resolver: async (parent, args, context) => {
                const { data: { dv, sender, organization, payment: paymentInput } } = args

                const acquiringContext = await getCashAcquiringContext(context, organization.id)
                const payment = await getById('Payment', paymentInput.id)
                const isCashPayment = payment && !payment.deletedAt && payment.context === acquiringContext.id && payment.organization === organization.id
                if (!isCashPayment || payment.status !== PAYMENT_DONE_STATUS) throw new GQLError(ERRORS.PAYMENT_NOT_FOUND, context)

                await Payment.update(context, payment.id, { dv, sender, status: PAYMENT_ERROR_STATUS })

                const receipt = await getById('BillingReceipt', payment.receipt)
                const paid = Big(await getNewPaymentsSum(receipt.id) || 0)
                const toPay = Big(receipt.toPay || 0)

                return { paymentId: payment.id, receiptToPay: formatMoney(toPay), receiptPaid: formatMoney(paid), receiptRemaining: formatMoney(toPay.minus(paid)) }
            },
        },
    ],
})

module.exports = {
    MonthlyChargesService,
    CASH_ACQUIRING_INTEGRATION_NAME,
    INTERNAL_BILLING_INTEGRATION_NAME,
}
