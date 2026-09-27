import { notification } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import Head from 'next/head'
import Link from 'next/link'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { Plus, Trash } from '@open-condo/icons'
import { useMutation, useQuery } from '@open-condo/next/apollo'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Alert, Button, Card, Input, Select, Space, Typography } from '@open-condo/ui'

import { PageContent, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import DatePicker from '@condo/domains/common/components/Pickers/DatePicker'
import { PageComponentType } from '@condo/domains/common/types'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'

import styles from './monthly-charges.module.css'


const GET_SETTINGS = gql`
    query getMonthlyChargesSettings ($data: GetMonthlyChargesSettingsInput!) {
        result: getMonthlyChargesSettings(data: $data) { tariffs { id name amount unitType } bankAccount bankName }
    }
`
const SAVE_SETTINGS = gql`
    mutation saveMonthlyChargesSettings ($data: SaveMonthlyChargesSettingsInput!) {
        result: saveMonthlyChargesSettings(data: $data) { tariffs { id name amount unitType } bankAccount bankName }
    }
`
const GENERATE_RECEIPTS = gql`
    mutation generateMonthlyBillingReceipts ($data: GenerateMonthlyBillingReceiptsInput!) {
        result: generateMonthlyBillingReceipts(data: $data) { receiptsCount failedCount totalToPay }
    }
`

type Tariff = { id: string, name: string, amount: string, unitType: string | null }
type GenerateResult = { receiptsCount: number, failedCount: number, totalToPay: string }

const SENDER = { dv: 1, fingerprint: 'monthly-charges-page' }
const ALL_UNIT_TYPES = 'all'
const UNIT_TYPES = ['flat', 'parking', 'apartment', 'commercial', 'warehouse']

const newTariff = (): Tariff => ({ id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: '', amount: '', unitType: null })

const getErrorMessage = (error): string => get(error, ['graphQLErrors', 0, 'extensions', 'messageForUser']) || get(error, 'message')

const MonthlyChargesPage: PageComponentType = () => {
    const intl = useIntl()
    const PageTitle = intl.formatMessage({ id: 'pages.billing.monthlyCharges.title' })
    const PageDescription = intl.formatMessage({ id: 'pages.billing.monthlyCharges.description' })
    const TariffsTitle = intl.formatMessage({ id: 'pages.billing.monthlyCharges.tariffs.title' })
    const TariffNamePlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.tariffs.namePlaceholder' })
    const TariffAmountPlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.tariffs.amount' })
    const AllUnitTypesLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.tariffs.unitType.all' })
    const AddTariffLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.tariffs.add' })
    const BankTitle = intl.formatMessage({ id: 'pages.billing.monthlyCharges.bank.title' })
    const BankAccountPlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.bank.account' })
    const BankNamePlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.bank.name' })
    const SaveLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.save' })
    const SavedMessage = intl.formatMessage({ id: 'pages.billing.monthlyCharges.saved' })
    const GenerateTitle = intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.title' })
    const GenerateDescription = intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.description' })
    const GenerateLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.button' })
    const SaveFirstMessage = intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.saveFirst' })
    const ViewReceiptsLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.viewReceipts' })

    const { organization } = useOrganization()
    const organizationId = get(organization, 'id')

    const [tariffs, setTariffs] = useState<Array<Tariff>>([newTariff()])
    const [bankAccount, setBankAccount] = useState('')
    const [bankName, setBankName] = useState('')
    const [isSaved, setIsSaved] = useState(false)
    const [period, setPeriod] = useState<Dayjs>(dayjs().startOf('month'))
    const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null)

    const { data, loading } = useQuery(GET_SETTINGS, {
        variables: { data: { organization: { id: organizationId } } },
        skip: !organizationId,
        fetchPolicy: 'network-only',
    })
    useEffect(() => {
        const settings = get(data, 'result')
        if (!settings) return
        if (settings.tariffs.length > 0) setTariffs(settings.tariffs.map(({ id, name, amount, unitType }) => ({ id, name, amount, unitType })))
        setBankAccount(settings.bankAccount || '')
        setBankName(settings.bankName || '')
        setIsSaved(settings.tariffs.length > 0 && !!settings.bankAccount)
    }, [data])

    const [saveSettings, { loading: saving }] = useMutation(SAVE_SETTINGS)
    const [generateReceipts, { loading: generating }] = useMutation(GENERATE_RECEIPTS)

    const updateTariff = useCallback((id: string, changes: Partial<Tariff>) => {
        setTariffs((current) => current.map((tariff) => tariff.id === id ? { ...tariff, ...changes } : tariff))
        setIsSaved(false)
    }, [])

    const handleSave = useCallback(async () => {
        try {
            await saveSettings({
                variables: {
                    data: {
                        dv: 1,
                        sender: SENDER,
                        organization: { id: organizationId },
                        tariffs: tariffs.filter(({ name, amount }) => name || amount),
                        bankAccount,
                        bankName: bankName || null,
                    },
                },
            })
            setIsSaved(true)
            notification.success({ message: SavedMessage })
        } catch (error) {
            notification.error({ message: getErrorMessage(error) })
        }
    }, [SavedMessage, bankAccount, bankName, organizationId, saveSettings, tariffs])

    const handleGenerate = useCallback(async () => {
        setGenerateResult(null)
        try {
            const { data } = await generateReceipts({
                variables: {
                    data: { dv: 1, sender: SENDER, organization: { id: organizationId }, period: period.format('YYYY-MM-01') },
                },
            })
            setGenerateResult(get(data, 'result', null))
        } catch (error) {
            notification.error({ message: getErrorMessage(error) })
        }
    }, [generateReceipts, organizationId, period])

    const unitTypeOptions = useMemo(() => [
        { label: AllUnitTypesLabel, value: ALL_UNIT_TYPES },
        ...UNIT_TYPES.map((unitType) => ({
            label: intl.formatMessage({ id: `pages.condo.ticket.field.unitType.${unitType}` as FormatjsIntl.Message['ids'] }),
            value: unitType,
        })),
    ], [AllUnitTypesLabel, intl])

    const formatMoney = (value: string) => `${intl.formatNumber(Number(value))} ₮`

    return (
        <>
            <Head><title>{PageTitle}</title></Head>
            <PageWrapper>
                <PageContent>
                    <Space direction='vertical' size={40} width='100%'>
                        <Space direction='vertical' size={8}>
                            <Typography.Title level={1}>{PageTitle}</Typography.Title>
                            <Typography.Text type='secondary'>{PageDescription}</Typography.Text>
                        </Space>

                        <Card>
                            <Space direction='vertical' size={24} width='100%'>
                                <Typography.Title level={3}>{TariffsTitle}</Typography.Title>
                                {tariffs.map((tariff) => (
                                    <div key={tariff.id} className={styles.tariffRow}>
                                        <Input
                                            placeholder={TariffNamePlaceholder}
                                            value={tariff.name}
                                            onChange={(event) => updateTariff(tariff.id, { name: event.target.value })}
                                        />
                                        <Input
                                            placeholder={TariffAmountPlaceholder}
                                            value={tariff.amount}
                                            inputMode='decimal'
                                            suffix='₮'
                                            onChange={(event) => updateTariff(tariff.id, { amount: event.target.value })}
                                        />
                                        <Select
                                            options={unitTypeOptions}
                                            value={tariff.unitType || ALL_UNIT_TYPES}
                                            onChange={(value) => updateTariff(tariff.id, { unitType: value === ALL_UNIT_TYPES ? null : String(value) })}
                                        />
                                        <Button
                                            type='secondary'
                                            icon={<Trash size='medium' />}
                                            disabled={tariffs.length === 1}
                                            onClick={() => {
                                                setTariffs((current) => current.filter(({ id }) => id !== tariff.id))
                                                setIsSaved(false)
                                            }}
                                        />
                                    </div>
                                ))}
                                <Button type='secondary' icon={<Plus size='medium' />} onClick={() => setTariffs((current) => [...current, newTariff()])}>
                                    {AddTariffLabel}
                                </Button>

                                <Typography.Title level={3}>{BankTitle}</Typography.Title>
                                <div className={styles.bankRow}>
                                    <Input
                                        placeholder={BankAccountPlaceholder}
                                        value={bankAccount}
                                        inputMode='numeric'
                                        onChange={(event) => { setBankAccount(event.target.value); setIsSaved(false) }}
                                    />
                                    <Input
                                        placeholder={BankNamePlaceholder}
                                        value={bankName}
                                        onChange={(event) => { setBankName(event.target.value); setIsSaved(false) }}
                                    />
                                </div>
                                <Button type='primary' loading={saving} disabled={loading} onClick={handleSave}>
                                    {SaveLabel}
                                </Button>
                            </Space>
                        </Card>

                        <Card>
                            <Space direction='vertical' size={24} width='100%'>
                                <Space direction='vertical' size={8}>
                                    <Typography.Title level={3}>{GenerateTitle}</Typography.Title>
                                    <Typography.Text type='secondary'>{GenerateDescription}</Typography.Text>
                                </Space>
                                <Space size={16} wrap>
                                    <DatePicker
                                        picker='month'
                                        format='YYYY-MM'
                                        allowClear={false}
                                        value={period}
                                        onChange={(value) => value && setPeriod(value.startOf('month'))}
                                    />
                                    <Button type='primary' loading={generating} disabled={!isSaved} onClick={handleGenerate}>
                                        {GenerateLabel}
                                    </Button>
                                </Space>
                                {!isSaved && !loading && <Typography.Text type='secondary'>{SaveFirstMessage}</Typography.Text>}
                                {generateResult && (
                                    <Alert
                                        type={generateResult.failedCount > 0 ? 'warning' : 'success'}
                                        showIcon
                                        message={intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.result' }, {
                                            count: generateResult.receiptsCount,
                                            total: formatMoney(generateResult.totalToPay),
                                        })}
                                        description={(
                                            <Space direction='vertical' size={8}>
                                                {generateResult.failedCount > 0 && intl.formatMessage({ id: 'pages.billing.monthlyCharges.generate.failed' }, { count: generateResult.failedCount })}
                                                <Link href='/billing'>{ViewReceiptsLabel}</Link>
                                            </Space>
                                        )}
                                    />
                                )}
                            </Space>
                        </Card>
                    </Space>
                </PageContent>
            </PageWrapper>
        </>
    )
}

MonthlyChargesPage.requiredAccess = OrganizationRequired

export default MonthlyChargesPage
