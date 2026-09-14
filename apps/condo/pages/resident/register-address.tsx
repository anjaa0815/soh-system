import { gql, useMutation } from '@apollo/client'
import { Col, Form, Row, Select } from 'antd'
import get from 'lodash/get'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, Input, Typography } from '@open-condo/ui'

import { useAddressApi } from '@condo/domains/common/components/AddressApi'
import { FormItem } from '@condo/domains/common/components/Form/FormItem'
import { useMutationErrorHandler } from '@condo/domains/common/hooks/useMutationErrorHandler'
import { useValidations } from '@condo/domains/common/hooks/useValidations'
import { PageComponentType } from '@condo/domains/common/types'
import { prefetchAuth } from '@condo/domains/common/utils/next/auth'
import { AddressSuggestionsSearchInput } from '@condo/domains/property/components/AddressSuggestionsSearchInput'
import {
    COMMERCIAL_UNIT_TYPE,
    FLAT_UNIT_TYPE,
    PARKING_UNIT_TYPE,
    WAREHOUSE_UNIT_TYPE,
} from '@condo/domains/property/constants/common'
import ResidentLayout from '@condo/domains/user/components/containers/ResidentLayout'


// NOTE: not imported from @condo/domains/resident/constants/errors - that module pulls in
// @open-condo/keystone/errors (a server-only, `fs`-dependent module), which breaks the client
// bundle for this page. These must stay in sync with that file's values.
const ADDRESS_NOT_FOUND_ERROR = 'ADDRESS_NOT_FOUND'
const ALREADY_REGISTERED_ERROR = 'ALREADY_REGISTERED'

const REGISTER_RESIDENT_MUTATION = gql`
    mutation registerMyResident ($data: RegisterResidentInput!) {
        result: registerResident(data: $data) { id }
    }
`

const UNIT_TYPE_OPTIONS = [FLAT_UNIT_TYPE, PARKING_UNIT_TYPE, COMMERCIAL_UNIT_TYPE, WAREHOUSE_UNIT_TYPE]

const RegisterAddressPage: PageComponentType = () => {
    const intl = useIntl()
    const TitleMessage = intl.formatMessage({ id: 'pages.resident.registerAddress.title' })
    const DescriptionMessage = intl.formatMessage({ id: 'pages.resident.registerAddress.description' })
    const AddressLabel = intl.formatMessage({ id: 'pages.resident.registerAddress.address' })
    const UnitNameLabel = intl.formatMessage({ id: 'pages.resident.registerAddress.unitName' })
    const UnitNamePlaceholder = intl.formatMessage({ id: 'pages.resident.registerAddress.unitName.placeholder' })
    const UnitTypeLabel = intl.formatMessage({ id: 'pages.resident.registerAddress.unitType' })
    const SubmitMessage = intl.formatMessage({ id: 'pages.resident.registerAddress.submit' })

    const unitTypeMessages: Record<string, string> = {
        [FLAT_UNIT_TYPE]: intl.formatMessage({ id: 'pages.resident.registerAddress.unitType.flat' }),
        [PARKING_UNIT_TYPE]: intl.formatMessage({ id: 'pages.resident.registerAddress.unitType.parking' }),
        [COMMERCIAL_UNIT_TYPE]: intl.formatMessage({ id: 'pages.resident.registerAddress.unitType.commercial' }),
        [WAREHOUSE_UNIT_TYPE]: intl.formatMessage({ id: 'pages.resident.registerAddress.unitType.warehouse' }),
    }
    const unitTypeOptions = useMemo(() => UNIT_TYPE_OPTIONS.map((value) => ({ value, label: unitTypeMessages[value] })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [intl])

    const router = useRouter()
    const { addressApi } = useAddressApi()
    const [form] = Form.useForm()
    const { requiredValidator } = useValidations()
    const [isLoading, setIsLoading] = useState(false)

    const onError = useMutationErrorHandler({
        form,
        typeToFieldMapping: {
            [ADDRESS_NOT_FOUND_ERROR]: 'address',
        },
    })
    const [registerResident] = useMutation(REGISTER_RESIDENT_MUTATION, { onError })

    const addressRules = useMemo(() => [requiredValidator], [requiredValidator])
    const unitNameRules = useMemo(() => [requiredValidator], [requiredValidator])

    const handleFinish = useCallback(async (values: { address: string, unitName: string, unitType: string }) => {
        setIsLoading(true)

        let address = values.address
        try {
            const cachedAddress = addressApi.getRawAddress(values.address)
            address = JSON.parse(cachedAddress).value
        } catch (e) {
            // Not selected from the suggestions dropdown - let the server try to resolve the typed text anyway,
            // it will come back as ADDRESS_NOT_FOUND if it can't.
        }

        try {
            const res = await registerResident({
                variables: {
                    data: {
                        dv: 1,
                        sender: getClientSideSenderInfo(),
                        address,
                        unitName: values.unitName,
                        unitType: values.unitType,
                    },
                },
            })

            if (get(res, ['data', 'result', 'id'])) {
                await router.push('/resident')
                return
            }
        } catch (error) {
            const errorType = get(error, ['graphQLErrors', 0, 'extensions', 'type'])
            if (errorType === ALREADY_REGISTERED_ERROR) {
                await router.push('/resident')
                return
            }
            // Other errors (including ADDRESS_NOT_FOUND) are already shown by onError/useMutationErrorHandler.
        } finally {
            setIsLoading(false)
        }
    }, [addressApi, registerResident, router])

    return (
        <>
            <Head><title>{TitleMessage}</title></Head>
            <Row gutter={[0, 24]}>
                <Col span={24}>
                    <Typography.Title level={2}>{TitleMessage}</Typography.Title>
                    <Typography.Text type='secondary'>{DescriptionMessage}</Typography.Text>
                </Col>
                <Col span={24}>
                    <Form
                        form={form}
                        layout='vertical'
                        onFinish={handleFinish}
                        initialValues={{ unitType: FLAT_UNIT_TYPE }}
                    >
                        <FormItem name='address' label={AddressLabel} rules={addressRules}>
                            <AddressSuggestionsSearchInput placeholder={AddressLabel} />
                        </FormItem>
                        <Row gutter={16}>
                            <Col span={14}>
                                <FormItem name='unitName' label={UnitNameLabel} rules={unitNameRules}>
                                    <Input placeholder={UnitNamePlaceholder} />
                                </FormItem>
                            </Col>
                            <Col span={10}>
                                <FormItem name='unitType' label={UnitTypeLabel}>
                                    <Select options={unitTypeOptions} />
                                </FormItem>
                            </Col>
                        </Row>
                        <Button type='primary' htmlType='submit' loading={isLoading} block>
                            {SubmitMessage}
                        </Button>
                    </Form>
                </Col>
            </Row>
        </>
    )
}

RegisterAddressPage.container = ResidentLayout
RegisterAddressPage.skipUserPrefetch = true

RegisterAddressPage.getPrefetchedData = async ({ apolloClient, context }) => {
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

export default RegisterAddressPage
