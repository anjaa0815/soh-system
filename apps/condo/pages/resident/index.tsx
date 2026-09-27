import { gql, useQuery } from '@apollo/client'
import { Col, Row } from 'antd'
import get from 'lodash/get'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useCallback } from 'react'

import { useIntl } from '@open-condo/next/intl'
import { Button, Typography } from '@open-condo/ui'

import { Loader } from '@condo/domains/common/components/Loader'
import { PageComponentType } from '@condo/domains/common/types'
import { prefetchAuth } from '@condo/domains/common/utils/next/auth'
import { ResidentBillsList } from '@condo/domains/resident/components/ResidentBillsList'
import ResidentLayout from '@condo/domains/user/components/containers/ResidentLayout'


const GET_MY_RESIDENTS_QUERY = gql`
    query getMyResidentsForDashboard {
        residents: allResidents(where: { deletedAt: null }) {
            id
        }
    }
`

const ResidentDashboardPage: PageComponentType = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.resident.dashboard.title' })
    const ComingSoonMessage = intl.formatMessage({ id: 'pages.resident.dashboard.comingSoon' })
    const NoAddressTitleMessage = intl.formatMessage({ id: 'pages.resident.dashboard.noAddress.title' })
    const NoAddressDescriptionMessage = intl.formatMessage({ id: 'pages.resident.dashboard.noAddress.description' })
    const RegisterAddressMessage = intl.formatMessage({ id: 'pages.resident.dashboard.registerAddress' })
    const AddAnotherAddressMessage = intl.formatMessage({ id: 'pages.resident.dashboard.addAnotherAddress' })

    const { data, loading } = useQuery(GET_MY_RESIDENTS_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
    const hasResidents = get(data, 'residents', []).length > 0

    const router = useRouter()
    const goToRegisterAddress = useCallback(() => router.push('/resident/register-address'), [router])

    return (
        <>
            <Head><title>{TitleMessage}</title></Head>
            <Row gutter={[0, 24]}>
                <Col span={24}>
                    <Typography.Title level={2}>
                        {TitleMessage}
                    </Typography.Title>
                </Col>

                {
                    loading && (
                        <Col span={24}>
                            <Loader fill size='large' />
                        </Col>
                    )
                }

                {
                    !loading && !hasResidents && (
                        <Col span={24}>
                            <Typography.Title level={4}>{NoAddressTitleMessage}</Typography.Title>
                            <Typography.Text type='secondary'>{NoAddressDescriptionMessage}</Typography.Text>
                            <Row style={{ marginTop: 16 }}>
                                <Col span={24}>
                                    <Button type='primary' block onClick={goToRegisterAddress}>
                                        {RegisterAddressMessage}
                                    </Button>
                                </Col>
                            </Row>
                        </Col>
                    )
                }

                {
                    !loading && hasResidents && (
                        <>
                            <Col span={24}>
                                <ResidentBillsList />
                            </Col>
                            <Col span={24}>
                                <Typography.Link onClick={goToRegisterAddress}>
                                    {AddAnotherAddressMessage}
                                </Typography.Link>
                            </Col>
                        </>
                    )
                }

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
