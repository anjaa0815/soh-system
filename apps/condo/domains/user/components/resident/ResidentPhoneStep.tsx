import { useStartConfirmPhoneActionMutation } from '@app/condo/gql'
import { Col, Form, Row } from 'antd'
import getConfig from 'next/config'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, Input } from '@open-condo/ui'

import { FormItem } from '@condo/domains/common/components/Form/FormItem'
import { useHCaptcha } from '@condo/domains/common/components/HCaptcha'
import { useMutationErrorHandler } from '@condo/domains/common/hooks/useMutationErrorHandler'
import { normalizePhone } from '@condo/domains/common/utils/phone'
import { ResponsiveCol } from '@condo/domains/user/components/containers/ResponsiveCol'
import { TOO_MANY_REQUESTS } from '@condo/domains/user/constants/errors'

import { useRegisterContext } from '../auth/RegisterContextProvider'


const { publicRuntimeConfig: { defaultLocale } } = getConfig()

const IDENTIFIER_INPUT_PROPS = { tabIndex: 1, autoFocus: true }

type ResidentPhoneStepProps = {
    onFinish: () => void
}

export const ResidentPhoneStep: React.FC<ResidentPhoneStepProps> = ({ onFinish }) => {
    const intl = useIntl()
    const PhoneMessage = intl.formatMessage({ id: 'pages.auth.register.field.Phone' })
    const ExamplePhoneMessage = intl.formatMessage({ id: 'example.Phone' })
    const FieldIsRequiredMessage = intl.formatMessage({ id: 'FieldIsRequired' })
    const TooManyRequestsErrorMessage = intl.formatMessage({ id: 'pages.auth.TooManyRequests' })
    const WrongPhoneFormatErrorMessage = intl.formatMessage({ id: 'api.common.WRONG_PHONE_FORMAT' })
    const SubmitMessage = intl.formatMessage({ id: 'Next' })

    const [form] = Form.useForm()
    const { executeCaptcha } = useHCaptcha()
    const { setToken, setIdentifier } = useRegisterContext()

    const [isLoading, setIsLoading] = useState(false)

    const phoneRules = useMemo(() => [{ required: true, message: FieldIsRequiredMessage }], [FieldIsRequiredMessage])

    const onError = useMutationErrorHandler({
        form,
        typeToFieldMapping: {
            [TOO_MANY_REQUESTS]: 'identifier',
        },
    })
    const [startConfirmPhoneAction] = useStartConfirmPhoneActionMutation({ onError })

    const startConfirmPhone = useCallback(async () => {
        if (isLoading) return

        const { identifier: inputPhone } = form.getFieldsValue(['identifier'])
        const phone = normalizePhone(inputPhone)
        if (!phone) {
            form.setFields([{ name: 'identifier', errors: [WrongPhoneFormatErrorMessage] }])
            return
        }
        setIdentifier(phone)
        setIsLoading(true)

        try {
            const sender = getClientSideSenderInfo()
            const captcha = await executeCaptcha()

            const res = await startConfirmPhoneAction({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        captcha,
                        phone,
                    },
                },
            })

            const token = res?.data?.result?.token
            if (!res.errors && token) {
                setToken(token)
                onFinish()
                return
            }
        } catch (error) {
            console.error('Start confirm phone action failed')
            console.error(error)
            form.setFields([
                {
                    name: 'identifier',
                    errors: [(error.friendlyDescription) ? error.friendlyDescription : TooManyRequestsErrorMessage],
                },
            ])
        } finally {
            setIsLoading(false)
        }
    }, [TooManyRequestsErrorMessage, WrongPhoneFormatErrorMessage, executeCaptcha, form, isLoading, onFinish, setIdentifier, setToken, startConfirmPhoneAction])

    return (
        <Form
            form={form}
            name='resident-input-phone'
            onFinish={startConfirmPhone}
            requiredMark={false}
            layout='vertical'
        >
            <Row justify='start'>
                <ResponsiveCol span={24}>
                    <Row gutter={[0, 40]}>
                        <Col span={24}>
                            <FormItem
                                name='identifier'
                                label={PhoneMessage}
                                rules={phoneRules}
                                data-cy='resident-identifier-item'
                            >
                                <Input.Phone country={defaultLocale} placeholder={ExamplePhoneMessage} inputProps={IDENTIFIER_INPUT_PROPS} />
                            </FormItem>
                        </Col>
                        <Col span={24}>
                            <Button
                                key='submit'
                                type='primary'
                                htmlType='submit'
                                loading={isLoading}
                                data-cy='resident-phone-submit-button'
                                block
                                tabIndex={2}
                            >
                                {SubmitMessage}
                            </Button>
                        </Col>
                    </Row>
                </ResponsiveCol>
            </Row>
        </Form>
    )
}
