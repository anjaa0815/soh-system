import { gql, useMutation, useQuery } from '@apollo/client'
import { Card, Col, Row } from 'antd'
import get from 'lodash/get'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, Typography } from '@open-condo/ui'


const GET_MY_SERVICE_CONSUMERS_QUERY = gql`
    query getMyResidentServiceConsumers {
        serviceConsumers: allServiceConsumers(where: { deletedAt: null }) {
            id
            accountNumber
            organization { id }
            resident { unitType unitName }
        }
    }
`

const GET_RECEIPTS_FOR_ACCOUNT_QUERY = gql`
    query getReceiptsForAccount ($accountNumber: String!) {
        receipts: allBillingReceipts(
            where: { deletedAt: null, account: { number: $accountNumber, deletedAt: null } },
            sortBy: [period_DESC],
            first: 20
        ) {
            id
            toPay
            paid
            period
        }
    }
`

const REGISTER_MULTI_PAYMENT_MUTATION = gql`
    mutation registerMyMultiPayment ($data: RegisterMultiPaymentInput!) {
        result: registerMultiPayment(data: $data) {
            multiPaymentId
            webViewUrl
        }
    }
`

type BillingReceipt = {
    id: string
    toPay: string
    paid: string | null
    period: string
}

type ServiceConsumer = {
    id: string
    accountNumber: string
    organization: { id: string }
    resident: { unitType: string | null, unitName: string | null } | null
}

const UNIT_TYPE_ICONS: Record<string, string> = {
    flat: '🏠',
    apartment: '🏠',
    parking: '🅿️',
    commercial: '🏪',
    warehouse: '📦',
}

type OnTotalsChange = (consumerId: string, unitType: string | null, totalUnpaid: number) => void

const ServiceConsumerBills: React.FC<{ serviceConsumer: ServiceConsumer, onTotalsChange: OnTotalsChange }> = ({ serviceConsumer, onTotalsChange }) => {
    const intl = useIntl()
    const PayMessage = intl.formatMessage({ id: 'pages.resident.bills.payButton' })
    const PeriodMessage = intl.formatMessage({ id: 'pages.resident.bills.period' })

    const unitType = get(serviceConsumer, ['resident', 'unitType'])
    const unitName = get(serviceConsumer, ['resident', 'unitName'])
    const unitTypeMessage = unitType ? intl.formatMessage({ id: `pages.resident.bills.unitType.${unitType}` }) : null
    const unitIcon = unitType ? UNIT_TYPE_ICONS[unitType] : null

    const [payingReceiptId, setPayingReceiptId] = useState<string | null>(null)

    const { data, loading } = useQuery(GET_RECEIPTS_FOR_ACCOUNT_QUERY, {
        variables: { accountNumber: serviceConsumer.accountNumber },
        fetchPolicy: 'network-only',
        errorPolicy: 'all',
    })
    const [registerMultiPayment] = useMutation(REGISTER_MULTI_PAYMENT_MUTATION)

    const receipts: BillingReceipt[] = get(data, 'receipts', [])
    const unpaidReceipts = useMemo(() => receipts.filter((receipt) => {
        const toPay = Number(receipt.toPay || 0)
        const paid = Number(receipt.paid || 0)
        return toPay - paid > 0
    }), [receipts])
    const totalUnpaid = useMemo(() => unpaidReceipts.reduce((sum, receipt) => {
        return sum + (Number(receipt.toPay || 0) - Number(receipt.paid || 0))
    }, 0), [unpaidReceipts])

    useEffect(() => {
        if (loading) return
        onTotalsChange(serviceConsumer.id, unitType || null, totalUnpaid)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, totalUnpaid, unitType, serviceConsumer.id])

    const handlePay = useCallback(async (receipt: BillingReceipt) => {
        setPayingReceiptId(receipt.id)
        try {
            const res = await registerMultiPayment({
                variables: {
                    data: {
                        dv: 1,
                        sender: getClientSideSenderInfo(),
                        groupedReceipts: [{
                            serviceConsumer: { id: serviceConsumer.id },
                            receipts: [{ id: receipt.id }],
                        }],
                    },
                },
            })

            const webViewUrl = get(res, ['data', 'result', 'webViewUrl'])
            if (webViewUrl) {
                window.location.href = webViewUrl
                return
            }
        } catch (error) {
            console.error('registerMultiPayment failed', error)
        } finally {
            setPayingReceiptId(null)
        }
    }, [serviceConsumer, registerMultiPayment])

    if (loading || unpaidReceipts.length === 0) return null

    return (
        <>
            {
                unitTypeMessage && (
                    <Col span={24}>
                        <Typography.Text type='secondary' size='medium'>
                            {unitIcon} {unitTypeMessage}{unitName ? ` · ${unitName}` : ''}
                        </Typography.Text>
                    </Col>
                )
            }
            {
                unpaidReceipts.map((receipt) => (
                    <Col span={24} key={receipt.id}>
                        <Card>
                            <Row justify='space-between' align='middle' gutter={[16, 16]}>
                                <Col>
                                    <Typography.Text strong>{Number(receipt.toPay).toLocaleString()} ₮</Typography.Text>
                                    <br />
                                    <Typography.Text type='secondary' size='small'>{PeriodMessage}: {receipt.period}</Typography.Text>
                                </Col>
                                <Col>
                                    <Button
                                        type='primary'
                                        loading={payingReceiptId === receipt.id}
                                        onClick={() => handlePay(receipt)}
                                    >
                                        {PayMessage}
                                    </Button>
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                ))
            }
        </>
    )
}

type ConsumerTotal = { unitType: string | null, total: number }

export const ResidentBillsList: React.FC = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.resident.bills.title' })
    const EmptyMessage = intl.formatMessage({ id: 'pages.resident.bills.empty' })
    const TotalMessage = intl.formatMessage({ id: 'pages.resident.bills.summary.total' })

    const { data, loading } = useQuery(GET_MY_SERVICE_CONSUMERS_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
    const serviceConsumers: ServiceConsumer[] = get(data, 'serviceConsumers', [])

    const [totalsByConsumer, setTotalsByConsumer] = useState<Record<string, ConsumerTotal>>({})
    const handleTotalsChange = useCallback<OnTotalsChange>((consumerId, unitType, total) => {
        setTotalsByConsumer((prev) => ({ ...prev, [consumerId]: { unitType, total } }))
    }, [])

    const totalsByUnitType = useMemo(() => {
        const totals: Record<string, number> = {}
        let grandTotal = 0
        for (const { unitType, total } of Object.values(totalsByConsumer)) {
            if (total <= 0) continue
            grandTotal += total
            const key = unitType || 'other'
            totals[key] = (totals[key] || 0) + total
        }
        return { byType: totals, grandTotal }
    }, [totalsByConsumer])

    if (loading) return null

    return (
        <Row gutter={[0, 16]}>
            <Col span={24}>
                <Typography.Title level={4}>{TitleMessage}</Typography.Title>
            </Col>
            {
                serviceConsumers.length === 0 && (
                    <Col span={24}>
                        <Typography.Text type='secondary'>{EmptyMessage}</Typography.Text>
                    </Col>
                )
            }
            {
                totalsByUnitType.grandTotal > 0 && (
                    <Col span={24}>
                        <Row justify='space-between' align='middle' gutter={[16, 4]}>
                            <Col>
                                <Typography.Text strong>
                                    {TotalMessage}: {totalsByUnitType.grandTotal.toLocaleString()} ₮
                                </Typography.Text>
                            </Col>
                            {
                                Object.entries(totalsByUnitType.byType).length > 1 && (
                                    <Col>
                                        <Typography.Text type='secondary' size='small'>
                                            {
                                                Object.entries(totalsByUnitType.byType).map(([unitType, total]) => {
                                                    const label = unitType === 'other'
                                                        ? null
                                                        : intl.formatMessage({ id: `pages.resident.bills.unitType.${unitType}` })
                                                    const icon = UNIT_TYPE_ICONS[unitType] || ''
                                                    return `${icon} ${label || ''}: ${total.toLocaleString()} ₮`
                                                }).join('   ')
                                            }
                                        </Typography.Text>
                                    </Col>
                                )
                            }
                        </Row>
                    </Col>
                )
            }
            {
                serviceConsumers.map((serviceConsumer) => (
                    <ServiceConsumerBills key={serviceConsumer.id} serviceConsumer={serviceConsumer} onTotalsChange={handleTotalsChange} />
                ))
            }
        </Row>
    )
}
