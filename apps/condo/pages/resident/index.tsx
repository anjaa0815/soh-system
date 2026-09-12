import { Col, Row } from 'antd'
import Head from 'next/head'
import React from 'react'

import { useIntl } from '@open-condo/next/intl'
import { Typography } from '@open-condo/ui'

import { prefetchAuth } from '@condo/domains/common/utils/next/auth'
import { PageComponentType } from '@condo/domains/common/types'
import { ResidentBillsList } from '@condo/domains/resident/components/ResidentBillsList'
import ResidentLayout from '@condo/domains/user/components/containers/ResidentLayout'


const ResidentDashboardPage: PageComponentType = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.resident.dashboard.title' })
    const ComingSoonMessage = intl.formatMessage({ id: 'pages.resident.dashboard.comingSoon' })

    return (
        <>
            <Head><title>{TitleMessage}</title></Head>
            <Row gutter={[0, 24]}>
                <Col span={24}>
                    <Typography.Title level={2}>
                        {TitleMessage}
                    </Typography.Title>
                </Col>
                <Col span={24}>
                    <ResidentBillsList />
                </Col>
                <Col span={24}>
                    <Typography.Text type='secondary'>
                        {ComingSoonMessage}
                    </Typography.Text>
                </Col>
            </Row>
        </>
    )
}

ResidentDashboardPage.container = ResidentLayout
ResidentDashboardPage.skipUserPrefetch = true

ResidentDashboardPage.getPrefetchedData = async ({ apolloClient, context }) => {
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

export default ResidentDashboardPage
