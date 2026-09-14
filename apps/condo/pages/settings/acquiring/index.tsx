import { Card, Col, Form, Row } from 'antd'
import get from 'lodash/get'
import Head from 'next/head'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { useOrganization } from '@open-condo/next/organization'
import { Button, Input, Typography } from '@open-condo/ui'

import { PageContent, PageWrapper } from '@condo/domains/common/components/containers/BaseLayout'
import { FormItem } from '@condo/domains/common/components/Form/FormItem'
import { Loader } from '@condo/domains/common/components/Loader'
import { PageComponentType } from '@condo/domains/common/types'
import { PermissionsRequired } from '@condo/domains/organization/components/OrganizationRequired'

import { getProviderBySlug, PROVIDERS } from '@condo/domains/acquiring/integrations/providers'
import { CONTEXT_FINISHED_STATUS } from '@condo/domains/acquiring/constants/context'
import { AcquiringIntegration, AcquiringIntegrationContext } from '@condo/domains/acquiring/utils/clientSchema'


const AcquiringSettingsPageAccessRequired: React.FC<React.PropsWithChildren> = ({ children }) => (
    <PermissionsRequired permissionKeys={['canManageIntegrations']} children={children} />
)

const PROVIDER_NAMES: Record<string, string> = {
    qpay: 'QPay',
    bonum: 'Bonum',
    byl: 'byl.mn',
}

const AcquiringSettingsPage: PageComponentType = () => {
    const intl = useIntl()
    const PageTitle = intl.formatMessage({ id: 'acquiring.settings.title' })
    const PageDescription = intl.formatMessage({ id: 'acquiring.settings.description' })
    const ConnectedLabel = intl.formatMessage({ id: 'acquiring.settings.connectedLabel' })
    const SelectMessage = intl.formatMessage({ id: 'acquiring.settings.selectButton' })
    const ChangeMessage = intl.formatMessage({ id: 'acquiring.settings.changeButton' })
    const CancelMessage = intl.formatMessage({ id: 'acquiring.settings.cancelButton' })
    const SaveMessage = intl.formatMessage({ id: 'Save' })
    const FieldIsRequiredMessage = intl.formatMessage({ id: 'FieldIsRequired' })

    const { organization, isLoading: orgLoading } = useOrganization()
    const orgId = get(organization, 'id', null)

    const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
    const [form] = Form.useForm()

    const { objs: integrations, loading: integrationsLoading, refetch: refetchIntegrations } = AcquiringIntegration.useObjects({
        where: { name_in: Object.values(PROVIDER_NAMES) },
    })

    const { objs: contexts, loading: contextsLoading, refetch: refetchContexts } = AcquiringIntegrationContext.useObjects({
        where: { organization: { id: orgId }, deletedAt: null },
    })

    const activeContext = contexts[0] || null
    const activeIntegrationName = get(activeContext, ['integration', 'name'], null)

    const createContextAction = AcquiringIntegrationContext.useCreate({
        status: CONTEXT_FINISHED_STATUS,
        state: { dv: 1 },
    })
    const softDeleteContextAction = AcquiringIntegrationContext.useSoftDelete()

    const refetchAll = useCallback(async () => {
        await Promise.all([refetchIntegrations(), refetchContexts()])
    }, [refetchIntegrations, refetchContexts])

    const handleChangeProvider = useCallback(async () => {
        if (activeContext) {
            await softDeleteContextAction(activeContext)
            await refetchAll()
        }
    }, [activeContext, softDeleteContextAction, refetchAll])

    const handleSelectProvider = useCallback((slug: string) => {
        setSelectedSlug(slug)
        form.resetFields()
    }, [form])

    const handleCancelSelection = useCallback(() => setSelectedSlug(null), [])

    const handleSubmit = useCallback(async (values: Record<string, string>) => {
        const provider = getProviderBySlug(selectedSlug)
        const integration = integrations.find((item) => item.name === PROVIDER_NAMES[selectedSlug])
        if (!provider || !integration || !orgId) return

        await createContextAction({
            organization: { connect: { id: orgId } },
            integration: { connect: { id: integration.id } },
            settings: { dv: 1, sender: getClientSideSenderInfo(), ...values },
        })

        setSelectedSlug(null)
        await refetchAll()
    }, [selectedSlug, integrations, orgId, createContextAction, refetchAll])

    const selectedProvider = useMemo(() => getProviderBySlug(selectedSlug), [selectedSlug])

    if (orgLoading || integrationsLoading || contextsLoading) {
        return <Loader fill size='large' />
    }

    return (
        <>
            <Head><title>{PageTitle}</title></Head>
            <PageWrapper>
                <PageContent>
                    <Row gutter={[0, 24]}>
                        <Col span={24}>
                            <Typography.Title level={2}>{PageTitle}</Typography.Title>
                            <Typography.Text type='secondary'>{PageDescription}</Typography.Text>
                        </Col>

                        {
                            activeContext && (
                                <Col span={24}>
                                    <Card>
                                        <Row justify='space-between' align='middle' gutter={[16, 16]}>
                                            <Col>
                                                <Typography.Text strong>{ConnectedLabel}: {activeIntegrationName}</Typography.Text>
                                            </Col>
                                            <Col>
                                                <Button type='secondary' onClick={handleChangeProvider}>{ChangeMessage}</Button>
                                            </Col>
                                        </Row>
                                    </Card>
                                </Col>
                            )
                        }

                        {
                            !activeContext && !selectedSlug && (
                                <Col span={24}>
                                    <Row gutter={[16, 16]}>
                                        {
                                            PROVIDERS.map((provider) => (
                                                <Col key={provider.slug} span={8}>
                                                    <Card>
                                                        <Row gutter={[0, 16]}>
                                                            <Col span={24}>
                                                                <Typography.Title level={4}>{provider.name}</Typography.Title>
                                                            </Col>
                                                            <Col span={24}>
                                                                <Button
                                                                    type='primary'
                                                                    block
                                                                    onClick={() => handleSelectProvider(provider.slug)}
                                                                >
                                                                    {SelectMessage}
                                                                </Button>
                                                            </Col>
                                                        </Row>
                                                    </Card>
                                                </Col>
                                            ))
                                        }
                                    </Row>
                                </Col>
                            )
                        }

                        {
                            !activeContext && selectedProvider && (
                                <Col span={24}>
                                    <Card title={selectedProvider.name}>
                                        <Form form={form} layout='vertical' onFinish={handleSubmit}>
                                            {
                                                selectedProvider.configFields.map((field) => (
                                                    <FormItem
                                                        key={field.name}
                                                        name={field.name}
                                                        label={intl.formatMessage({ id: field.labelId })}
                                                        rules={field.required ? [{ required: true, message: FieldIsRequiredMessage }] : []}
                                                    >
                                                        {
                                                            field.type === 'password'
                                                                ? <Input.Password />
                                                                : <Input />
                                                        }
                                                    </FormItem>
                                                ))
                                            }
                                            <Row gutter={[16, 0]}>
                                                <Col>
                                                    <Button type='primary' htmlType='submit'>{SaveMessage}</Button>
                                                </Col>
                                                <Col>
                                                    <Button type='secondary' onClick={handleCancelSelection}>{CancelMessage}</Button>
                                                </Col>
                                            </Row>
                                        </Form>
                                    </Card>
                                </Col>
                            )
                        }
                    </Row>
                </PageContent>
            </PageWrapper>
        </>
    )
}

AcquiringSettingsPage.requiredAccess = AcquiringSettingsPageAccessRequired

export default AcquiringSettingsPage
