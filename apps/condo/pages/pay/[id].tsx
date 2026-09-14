import { gql, useMutation } from '@apollo/client'
import { QRCodeCanvas } from '@rc-component/qrcode'
import { Col, Row } from 'antd'
import get from 'lodash/get'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Typography } from '@open-condo/ui'

import { Loader } from '@condo/domains/common/components/Loader'
import { PageComponentType } from '@condo/domains/common/types'
import { prefetchAuth } from '@condo/domains/common/utils/next/auth'
import ResidentLayout from '@condo/domains/user/components/containers/ResidentLayout'


const CREATE_ACQUIRING_PAYMENT_DETAILS_MUTATION = gql`
    mutation createMyAcquiringPaymentDetails ($data: CreateAcquiringPaymentDetailsInput!) {
        result: createAcquiringPaymentDetails(data: $data) {
            providerSlug
            qrText
            qrImageBase64
        }
    }
`

const PayPage: PageComponentType = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.pay.title' })
    const QrInfoMessage = intl.formatMessage({ id: 'pages.pay.qrInfo' })
    const ErrorMessage = intl.formatMessage({ id: 'ServerError' })

    const router = useRouter()
    const { id } = router.query
    const multiPaymentId = typeof id === 'string' ? id : null

    const [createPaymentDetails] = useMutation(CREATE_ACQUIRING_PAYMENT_DETAILS_MUTATION)
    const [qrText, setQrText] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!multiPaymentId) return

        createPaymentDetails({
            variables: {
                data: {
                    dv: 1,
                    sender: getClientSideSenderInfo(),
                    multiPayment: { id: multiPaymentId },
                },
            },
        })
            .then((res) => {
                const resultQrText = get(res, ['data', 'result', 'qrText'])
                if (resultQrText) {
                    setQrText(resultQrText)
                } else {
                    setError(ErrorMessage)
                }
            })
            .catch((err) => {
                console.warn('createAcquiringPaymentDetails failed', err)
                setError(get(err, 'friendlyDescription') || ErrorMessage)
            })
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [multiPaymentId])

    return (
        <>
            <Head><title>{TitleMessage}</title></Head>
            <Row justify='center' gutter={[0, 24]}>
                <Col span={24}>
                    <Typography.Title level={3} style={{ textAlign: 'center' }}>{TitleMessage}</Typography.Title>
                </Col>

                {
                    loading && (
                        <Col span={24}>
                            <Loader fill size='large' />
                        </Col>
                    )
                }

                {
                    !loading && error && (
                        <Col span={24}>
                            <Typography.Text type='danger' style={{ display: 'block', textAlign: 'center' }}>
                                {error}
                            </Typography.Text>
                        </Col>
                    )
                }

                {
                    !loading && qrText && (
                        <>
                            <Col span={24}>
                                <Row justify='center'>
                                    <Col>
                                        <QRCodeCanvas value={qrText} size={220} level='M' />
                                    </Col>
                                </Row>
                            </Col>
                            <Col span={24}>
                                <Typography.Text type='secondary' style={{ display: 'block', textAlign: 'center' }}>
                                    {QrInfoMessage}
                                </Typography.Text>
                            </Col>
                        </>
                    )
                }
            </Row>
        </>
    )
}

PayPage.container = ResidentLayout
PayPage.skipUserPrefetch = true

PayPage.getPrefetchedData = async ({ apolloClient, context }) => {
    const user = await prefetchAuth(apolloClient)

    if (!user || user.type !== 'resident') {
        const { asPath } = context
        return {
            redirect: {
                destination: `/auth/resident?next=${encodeURIComponent(asPath)}`,
                permanent: false,
            },
        }
    }

    return {
        props: {},
    }
}

export default PayPage
