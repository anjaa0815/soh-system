import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useMemo } from 'react'

import { useFeatureFlags } from '@open-condo/featureflags/FeatureFlagsContext'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Card, Space, Typography } from '@open-condo/ui'

import { CONTEXT_FINISHED_STATUS, CONTEXT_VERIFICATION_STATUS } from '@condo/domains/acquiring/constants/context'
import { AcquiringIntegrationContext as AcquiringContext } from '@condo/domains/acquiring/utils/clientSchema'
import { BillingPageContent } from '@condo/domains/billing/components/BillingPageContent'
import { BillingAndAcquiringContext } from '@condo/domains/billing/components/BillingPageContent/ContextProvider'
import { BillingIntegrationOrganizationContext as BillingContext } from '@condo/domains/billing/utils/clientSchema'
import { PageContent, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import LoadingOrErrorPage from '@condo/domains/common/components/containers/LoadingOrErrorPage'
import { UI_BILLING_SPP_COMBINED_PAGE } from '@condo/domains/common/constants/featureflags'
import { PageComponentType } from '@condo/domains/common/types'
import { CONTEXT_FINISHED_STATUS as BILLING_FINISHED_STATUS } from '@condo/domains/miniapp/constants'
import { OrganizationRequired } from '@condo/domains/organization/components/OrganizationRequired'

/**
 * Shown until the organization has a billing: monthly charges (fixed fees) are set up on /billing/monthly-charges
 * and online payments (QPay etc.) on /settings/acquiring
 */
const BillingSetupPlaceholder: React.FC<{ title: string }> = ({ title }) => {
    const intl = useIntl()
    const Description = intl.formatMessage({ id: 'pages.billing.setupPlaceholder.description' })
    const MonthlyChargesLabel = intl.formatMessage({ id: 'pages.billing.setupPlaceholder.monthlyCharges' })
    const AcquiringLabel = intl.formatMessage({ id: 'pages.billing.setupPlaceholder.acquiring' })
    const router = useRouter()

    return (
        <>
            <Head><title>{title}</title></Head>
            <PageWrapper>
                <PageContent>
                    <Space direction='vertical' size={40} width='100%'>
                        <Typography.Title level={1}>{title}</Typography.Title>
                        <Card>
                            <Space direction='vertical' size={24} width='100%'>
                                <Typography.Text type='secondary'>{Description}</Typography.Text>
                                <Space size={16} wrap>
                                    <Button type='primary' onClick={() => router.push('/billing/monthly-charges')}>
                                        {MonthlyChargesLabel}
                                    </Button>
                                    <Button type='secondary' onClick={() => router.push('/settings/acquiring')}>
                                        {AcquiringLabel}
                                    </Button>
                                </Space>
                            </Space>
                        </Card>
                    </Space>
                </PageContent>
            </PageWrapper>
        </>
    )
}

const AccrualsAndPaymentsPage: PageComponentType = () => {
    const intl = useIntl()
    const { useFlag } = useFeatureFlags()
    const isCombinedPageEnabled = useFlag(UI_BILLING_SPP_COMBINED_PAGE)
    const PageTitle = intl.formatMessage({ id: isCombinedPageEnabled ? 'global.section.SPP' : 'global.section.accrualsAndPayments' })

    const userOrganization = useOrganization()
    const orgId = userOrganization?.organization?.id ?? null
    const organizationWhere = useMemo(() => ({ organization: { id: orgId } }), [orgId])

    const { objs: billingContexts, loading: billingLoading, error: billingError, refetch: refetchBilling } = BillingContext.useObjects({
        where: {
            ...organizationWhere,
            ...(!isCombinedPageEnabled && { status: BILLING_FINISHED_STATUS }),
        },
    }, { skip: !orgId })

    const { objs: acquiringContexts, loading: acquiringLoading, error: acquiringError } = AcquiringContext.useObjects({
        where: {
            ...organizationWhere,
            ...(!isCombinedPageEnabled && { status_in: [CONTEXT_FINISHED_STATUS, CONTEXT_VERIFICATION_STATUS] }),
        },
    }, { skip: !orgId })

    const hasFinishedBillingContext = useMemo(() => {
        return billingContexts.some(({ status }) => status === BILLING_FINISHED_STATUS)
    }, [billingContexts])

    const providerValue = useMemo(() => ({
        billingContexts,
        acquiringContexts,
        refetchBilling,
    }), [acquiringContexts, billingContexts, refetchBilling])

    // NOTE: receipts are shown without an acquiring context too: online payments (QPay etc.) are set up
    // separately on /settings/acquiring, and the acquiring onboarding (SberBusiness offer) does not apply here
    const canShowBillingPage = hasFinishedBillingContext

    if (acquiringLoading || billingLoading || acquiringError || billingError) {
        return (
            <LoadingOrErrorPage
                title={PageTitle}
                error={acquiringError || billingError}
                loading={acquiringLoading || billingLoading}
            />
        )
    }

    if (canShowBillingPage) {
        return (
            <BillingAndAcquiringContext.Provider value={providerValue}>
                <BillingPageContent/>
            </BillingAndAcquiringContext.Provider>
        )
    }

    return <BillingSetupPlaceholder title={PageTitle}/>
}

AccrualsAndPaymentsPage.requiredAccess = OrganizationRequired

export default AccrualsAndPaymentsPage
