import { notification, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { gql } from 'graphql-tag'
import get from 'lodash/get'
import React, { useCallback, useMemo, useState } from 'react'

import { useMutation, useQuery } from '@open-condo/next/apollo'
import { useIntl } from '@open-condo/next/intl'
import { Button, Card, Input, Modal, Space, Typography } from '@open-condo/ui'

import DatePicker from '@condo/domains/common/components/Pickers/DatePicker'

import styles from './CashPaymentsCard.module.css'

import type { ColumnsType } from 'antd/lib/table'


const GET_RECEIPTS = gql`
    query getMonthlyReceipts ($data: GetMonthlyReceiptsInput!) {
        result: getMonthlyReceipts(data: $data) {
            id accountNumber unitName unitType address toPay paid remaining
            cashPayments { id amount paidAt purpose }
        }
    }
`
const REGISTER_CASH_PAYMENT = gql`
    mutation registerCashPayment ($data: RegisterCashPaymentInput!) {
        result: registerCashPayment(data: $data) { paymentId receiptRemaining }
    }
`
const CANCEL_CASH_PAYMENT = gql`
    mutation cancelCashPayment ($data: CancelCashPaymentInput!) {
        result: cancelCashPayment(data: $data) { paymentId receiptRemaining }
    }
`

type CashPayment = { id: string, amount: string, paidAt: string | null, purpose: string | null }
type MonthlyReceipt = {
    id: string
    accountNumber: string
    unitName: string | null
    unitType: string | null
    address: string | null
    toPay: string
    paid: string
    remaining: string
    cashPayments: Array<CashPayment>
}

const SENDER = { dv: 1, fingerprint: 'monthly-charges-cash-payments' }
const PAGE_SIZE = 20

const getErrorMessage = (error): string => get(error, ['graphQLErrors', 0, 'extensions', 'messageForUser']) || get(error, 'message')

type CashPaymentsCardProps = {
    organizationId: string
    period: Dayjs
}

/**
 * Receipts of the month with paid / remaining amounts, where payments made in cash
 * or by a bank transfer outside of the system are registered by hand
 */
export const CashPaymentsCard: React.FC<CashPaymentsCardProps> = ({ organizationId, period }) => {
    const intl = useIntl()
    const Title = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.title' })
    const Description = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.description' })
    const SearchPlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.search' })
    const AccountColumn = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.column.account' })
    const AddressColumn = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.column.address' })
    const ToPayColumn = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.column.toPay' })
    const PaidColumn = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.column.paid' })
    const RemainingColumn = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.column.remaining' })
    const RegisterLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.register' })
    const AmountLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.amount' })
    const PaidAtLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.paidAt' })
    const PurposePlaceholder = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.purpose' })
    const SaveLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.save' })
    const RegisteredMessage = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.registered' })
    const HistoryTitle = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.history' })
    const CancelLabel = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.cancel' })
    const CancelConfirm = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.cancelConfirm' })
    const CancelledMessage = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.cancelled' })
    const EmptyMessage = intl.formatMessage({ id: 'pages.billing.monthlyCharges.cash.empty' })

    const [search, setSearch] = useState('')
    const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null)
    const [amount, setAmount] = useState('')
    const [paidAt, setPaidAt] = useState<Dayjs>(dayjs())
    const [purpose, setPurpose] = useState('')

    const { data, loading, refetch } = useQuery(GET_RECEIPTS, {
        variables: { data: { organization: { id: organizationId }, period: period.format('YYYY-MM-01') } },
        skip: !organizationId,
        fetchPolicy: 'network-only',
    })
    const receipts: Array<MonthlyReceipt> = useMemo(() => get(data, 'result') || [], [data])
    const selectedReceipt = useMemo(() => receipts.find(({ id }) => id === selectedReceiptId) || null, [receipts, selectedReceiptId])

    const filteredReceipts = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return receipts
        return receipts.filter(({ accountNumber, unitName, address }) =>
            [accountNumber, unitName, address].some((value) => value && value.toLowerCase().includes(query)))
    }, [receipts, search])

    const [registerCashPayment, { loading: registering }] = useMutation(REGISTER_CASH_PAYMENT)
    const [cancelCashPayment] = useMutation(CANCEL_CASH_PAYMENT)

    const formatMoney = useCallback((value: string) => `${intl.formatNumber(Number(value))} ₮`, [intl])

    const openRegisterModal = useCallback((receipt: MonthlyReceipt) => {
        setSelectedReceiptId(receipt.id)
        setAmount(Number(receipt.remaining) > 0 ? String(Number(receipt.remaining)) : '')
        setPaidAt(dayjs())
        setPurpose('')
    }, [])

    const handleRegister = useCallback(async () => {
        try {
            await registerCashPayment({
                variables: {
                    data: {
                        dv: 1,
                        sender: SENDER,
                        organization: { id: organizationId },
                        receipt: { id: selectedReceiptId },
                        amount,
                        paidAt: paidAt.format('YYYY-MM-DD'),
                        purpose: purpose || null,
                    },
                },
            })
            notification.success({ message: RegisteredMessage })
            setSelectedReceiptId(null)
            await refetch()
        } catch (error) {
            notification.error({ message: getErrorMessage(error) })
        }
    }, [RegisteredMessage, amount, organizationId, paidAt, purpose, refetch, registerCashPayment, selectedReceiptId])

    const handleCancel = useCallback(async (paymentId: string) => {
        if (!window.confirm(CancelConfirm)) return
        try {
            await cancelCashPayment({
                variables: { data: { dv: 1, sender: SENDER, organization: { id: organizationId }, payment: { id: paymentId } } },
            })
            notification.success({ message: CancelledMessage })
            await refetch()
        } catch (error) {
            notification.error({ message: getErrorMessage(error) })
        }
    }, [CancelConfirm, CancelledMessage, cancelCashPayment, organizationId, refetch])

    const columns: ColumnsType<MonthlyReceipt> = useMemo(() => [
        { key: 'account', title: AccountColumn, dataIndex: 'accountNumber', width: 140 },
        {
            key: 'address',
            title: AddressColumn,
            render: (_, receipt) => (
                <Space direction='vertical' size={0}>
                    <Typography.Text size='medium'>{receipt.unitName}</Typography.Text>
                    <Typography.Text size='small' type='secondary'>{receipt.address}</Typography.Text>
                </Space>
            ),
        },
        { key: 'toPay', title: ToPayColumn, align: 'right', render: (_, receipt) => formatMoney(receipt.toPay) },
        { key: 'paid', title: PaidColumn, align: 'right', render: (_, receipt) => formatMoney(receipt.paid) },
        {
            key: 'remaining',
            title: RemainingColumn,
            align: 'right',
            render: (_, receipt) => (
                <Typography.Text strong type={Number(receipt.remaining) > 0 ? 'danger' : 'success'}>
                    {formatMoney(receipt.remaining)}
                </Typography.Text>
            ),
        },
        {
            key: 'action',
            align: 'right',
            render: (_, receipt) => (
                <Button type='secondary' size='medium' onClick={() => openRegisterModal(receipt)}>{RegisterLabel}</Button>
            ),
        },
    ], [AccountColumn, AddressColumn, PaidColumn, RegisterLabel, RemainingColumn, ToPayColumn, formatMoney, openRegisterModal])

    return (
        <Card>
            <Space direction='vertical' size={24} width='100%'>
                <Space direction='vertical' size={8}>
                    <Typography.Title level={3}>{Title}</Typography.Title>
                    <Typography.Text type='secondary'>{Description}</Typography.Text>
                </Space>
                <Input placeholder={SearchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
            </Space>
            <div className={styles.table}>
                <Table
                    rowKey='id'
                    size='small'
                    loading={loading}
                    columns={columns}
                    dataSource={filteredReceipts}
                    pagination={{ pageSize: PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false }}
                    locale={{ emptyText: EmptyMessage }}
                />
            </div>
            <Modal
                open={!!selectedReceipt}
                title={selectedReceipt ? `${RegisterLabel}: ${selectedReceipt.accountNumber}` : RegisterLabel}
                onCancel={() => setSelectedReceiptId(null)}
                footer={<Button type='primary' loading={registering} onClick={handleRegister}>{SaveLabel}</Button>}
            >
                {selectedReceipt && (
                    <Space direction='vertical' size={16} width='100%'>
                        <Typography.Text type='secondary'>
                            {selectedReceipt.address}, {selectedReceipt.unitName} · {RemainingColumn}: {formatMoney(selectedReceipt.remaining)}
                        </Typography.Text>
                        <div className={styles.formRow}>
                            <Space direction='vertical' size={8}>
                                <Typography.Text size='medium'>{AmountLabel}</Typography.Text>
                                <Input value={amount} inputMode='decimal' suffix='₮' onChange={(event) => setAmount(event.target.value)} />
                            </Space>
                            <Space direction='vertical' size={8}>
                                <Typography.Text size='medium'>{PaidAtLabel}</Typography.Text>
                                <DatePicker value={paidAt} allowClear={false} format='YYYY-MM-DD' onChange={(value) => value && setPaidAt(value)} />
                            </Space>
                        </div>
                        <Input placeholder={PurposePlaceholder} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
                        {selectedReceipt.cashPayments.length > 0 && (
                            <Space direction='vertical' size={8} width='100%'>
                                <Typography.Text strong>{HistoryTitle}</Typography.Text>
                                {selectedReceipt.cashPayments.map((payment) => (
                                    <div key={payment.id} className={styles.historyRow}>
                                        <Typography.Text size='medium'>
                                            {payment.paidAt ? dayjs(payment.paidAt).format('YYYY-MM-DD') : ''} · {formatMoney(payment.amount)}
                                            {payment.purpose ? ` · ${payment.purpose}` : ''}
                                        </Typography.Text>
                                        <Button type='secondary' size='medium' onClick={() => handleCancel(payment.id)}>{CancelLabel}</Button>
                                    </div>
                                ))}
                            </Space>
                        )}
                    </Space>
                )}
            </Modal>
        </Card>
    )
}
