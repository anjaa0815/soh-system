import { useStartConfirmPhoneActionMutation, useStartConfirmEmailActionMutation } from '@app/condo/gql'
import { Col, Form, Row } from 'antd'
import getConfig from 'next/config'
import React, { useCallback, useMemo, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useIntl } from '@open-condo/next/intl'
import { Button, Input } from '@open-condo/ui'

import { FormItem } from '@condo/domains/common/components/Form/FormItem'
import { useHCaptcha } from '@condo/domains/common/components/HCaptcha'
import { useMutationErrorHandler } from '@condo/domains/common/hooks/useMutationErrorHandler'
import { ResponsiveCol } from '@condo/domains/user/components/containers/ResponsiveCol'
import { TOO_MANY_REQUESTS } from '@condo/domains/user/constants/errors'
import { normalizeUserIdentifier } from '@condo/domains/user/utils/helpers'

import { useRegisterContext } from '../auth/RegisterContextProvider'

import type { FetchResult } from '@apollo/client/link/core'
import type { StartConfirmEmailActionMutation, StartConfirmPhoneActionMutation } from '@app/condo/gql'


const { publicRuntimeConfig: { defaultLocale, residentAuthMethods } } = getConfig()

// NOTE: keep phone-only unless RESIDENT_AUTH_METHODS explicitly enables email, so existing
// deployments that never configured this keep their current single-field phone form.
const isEmailEnabled = Array.isArray(residentAuthMethods) && residentAuthMethods.includes('email')

const IDENTIFIER_INPUT_PROPS = { tabIndex: 1, autoFocus: true }

type ResidentIdentifierStepProps = {
    onFinish: () => void
}

export const ResidentIdentifierStep: React.FC<ResidentIdentifierStepProps> = ({ onFinish }) => {
    const intl = useIntl()
    const PhoneMessage = intl.formatMessage({ id: 'pages.auth.register.field.Phone' })
    const PhoneOrEmailMessage = intl.formatMessage({ id: 'pages.auth.register.field.PhoneOrEmail' })
    const ExamplePhoneMessage = intl.formatMessage({ id: 'example.Phone' })
    const FieldIsRequiredMessage = intl.formatMessage({ id: 'FieldIsRequired' })
    const TooManyRequestsErrorMessage = intl.formatMessage({ id: 'pages.auth.TooManyRequests' })
    const WrongPhoneFormatErrorMessage = intl.formatMessage({ id: 'api.common.WRONG_PHONE_FORMAT' })
    const WrongPhoneOrEmailFormatErrorMessage = intl.formatMessage({ id: 'common.errors.WRONG_PHONE_OR_EMAIL_FORMAT' })
    const SubmitMessage = intl.formatMessage({ id: 'Next' })

    const WrongIdentifierFormatErrorMessage = isEmailEnabled ? WrongPhoneOrEmailFormatErrorMessage : WrongPhoneFormatErrorMessage

    const [form] = Form.useForm()
    const { executeCaptcha } = useHCaptcha()
    const { setToken, setIdentifier } = useRegisterContext()

    const [isLoading, setIsLoading] = useState(false)

    const identifierRules = useMemo(() => [{ required: true, message: FieldIsRequiredMessage }], [FieldIsRequiredMessage])

    const onError = useMutationErrorHandler({
        form,
        typeToFieldMapping: {
            [TOO_MANY_REQUESTS]: 'identifier',
        },
    })
    const [startConfirmPhoneAction] = useStartConfirmPhoneActionMutation({ onError })
    const [startConfirmEmailAction] = useStartConfirmEmailActionMutation({ onError })

    const startConfirmIdentifier = useCallback(async () => {
        if (isLoading) return

        const { identifier: inputIdentifier } = form.getFieldsValue(['identifier'])
        const parsedIdentifier = normalizeUserIdentifier(inputIdentifier)
        const identifier = (isEmailEnabled || parsedIdentifier.type === 'phone')
            ? parsedIdentifier
            : { type: null, normalizedValue: null }

        if (!identifier.normalizedValue) {
            form.setFields([{ name: 'identifier', errors: [WrongIdentifierFormatErrorMessage] }])
            return
        }
        setIdentifier(identifier.normalizedValue)
        setIsLoading(true)

        try {
            const sender = getClientSideSenderInfo()
            const captcha = await executeCaptcha()
            const commonPayload = { dv: 1, sender, captcha }

            let res: FetchResult<StartConfirmEmailActionMutation> | FetchResult<StartConfirmPhoneActionMutation>
            if (identifier.type === 'email') {
                res = await startConfirmEmailAction({
                    variables: { data: { ...commonPayload, email: identifier.normalizedValue } },
                })
            } else {
                res = await startConfirmPhoneAction({
                    variables: { data: { ...commonPayload, phone: identifier.normalizedValue } },
                })
            }

            const token = res?.data?.result?.token
            if (!res.errors && token) {
                setToken(token)
                onFinish()
                return
            }
        } catch (error) {
            console.error('Start confirm identifier action failed')
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
    }, [TooManyRequestsErrorMessage, WrongIdentifierFormatErrorMessage, executeCaptcha, form, isLoading, onFinish, setIdentifier, setToken, startConfirmEmailAction, startConfirmPhoneAction])

    return (
        <Form
            form={form}
            name='resident-input-identifier'
            onFinish={startConfirmIdentifier}
            requiredMark={false}
            layout='vertical'
        >
            <Row justify='start'>
                <ResponsiveCol span={24}>
                    <Row gutter={[0, 40]}>
                        <Col span={24}>
                            {
                                isEmailEnabled ? (
                                    <FormItem
                                        name='identifier'
                                        label={PhoneOrEmailMessage}
                                        rules={identifierRules}
                                        data-cy='resident-identifier-item'
                                    >
                                        <Input {...IDENTIFIER_INPUT_PROPS} />
                                    </FormItem>
                                ) : (
                                    <FormItem
                                        name='identifier'
                                        label={PhoneMessage}
                                        rules={identifierRules}
                                        data-cy='resident-identifier-item'
                                    >
                                        <Input.Phone country={defaultLocale} placeholder={ExamplePhoneMessage} inputProps={IDENTIFIER_INPUT_PROPS} />
                                    </FormItem>
                                )
                            }
                        </Col>
                        <Col span={24}>
                            <Button
                                key='submit'
                                type='primary'
                                htmlType='submit'
                                loading={isLoading}
                                data-cy='resident-identifier-submit-button'
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
