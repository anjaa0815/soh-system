import { gql, useMutation, useQuery } from '@apollo/client'
import { Card, Col, Row } from 'antd'
import get from 'lodash/get'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, Typography } from '@open-condo/ui'


const GET_MY_SERVICE_CONSUMERS_QUERY = gql`
    query getMyResidentServiceConsumers {
        serviceConsumers: allServiceConsumers(where: { deletedAt: null }) {
            id
            accountNumber
            organization { id }
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
}

const ServiceConsumerBills: React.FC<{ serviceConsumer: ServiceConsumer }> = ({ serviceConsumer }) => {
    const intl = useIntl()
    const PayMessage = intl.formatMessage({ id: 'pages.resident.bills.payButton' })
    const PeriodMessage = intl.formatMessage({ id: 'pages.resident.bills.period' })

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

export const ResidentBillsList: React.FC = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.resident.bills.title' })
    const EmptyMessage = intl.formatMessage({ id: 'pages.resident.bills.empty' })

    const { data, loading } = useQuery(GET_MY_SERVICE_CONSUMERS_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
    const serviceConsumers: ServiceConsumer[] = get(data, 'serviceConsumers', [])

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
                serviceConsumers.map((serviceConsumer) => (
                    <ServiceConsumerBills key={serviceConsumer.id} serviceConsumer={serviceConsumer} />
                ))
            }
        </Row>
    )
}
