import { useAuthenticateOrRegisterUserWithTokenMutation } from '@app/condo/gql'
import { UserTypeType } from '@app/condo/schema'
import { QRCodeCanvas } from '@rc-component/qrcode'
import { Col, notification, Row } from 'antd'
import { setCookie } from 'cookies-next'
import getConfig from 'next/config'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { useCallback, useState } from 'react'

import { getClientSideSenderInfo } from '@open-condo/miniapp-utils/helpers/sender'
import { useEffectOnce } from '@open-condo/miniapp-utils'
import { useAuth } from '@open-condo/next/auth'
import { useIntl } from '@open-condo/next/intl'
import { Typography } from '@open-condo/ui'

import { useHCaptcha } from '@condo/domains/common/components/HCaptcha'
import { COOKIE_MAX_AGE_IN_SEC } from '@condo/domains/common/constants/cookies'
import { PageComponentType } from '@condo/domains/common/types'
import { isSafeUrl } from '@condo/domains/common/utils/url.utils'
import { InfoBlock } from '@condo/domains/user/components/auth/InfoBlock'
import { RegisterContextProvider, useRegisterContext } from '@condo/domains/user/components/auth/RegisterContextProvider'
import { ValidateIdentifierForm } from '@condo/domains/user/components/auth/ValidateIdentifierForm'
import AuthLayout from '@condo/domains/user/components/containers/AuthLayout'
import { ResponsiveCol } from '@condo/domains/user/components/containers/ResponsiveCol'
import { ResidentPhoneStep } from '@condo/domains/user/components/resident/ResidentPhoneStep'
import { WelcomeHeaderTitle } from '@condo/domains/user/components/UserWelcomeTitle'
import { AUTH_FLOW_USER_TYPE_COOKIE_NAME } from '@condo/domains/user/constants/auth'


const {
    publicRuntimeConfig: {
        residentAppInfo,
    },
} = getConfig()

const hasResidentMobileApp = Boolean(residentAppInfo?.mobile?.help && residentAppInfo?.mobile?.download)

const ResidentAuthForm: React.FC = () => {
    const intl = useIntl()
    const ResidentAuthTitle = intl.formatMessage({ id: 'pages.auth.resident.title' })
    const ResidentAuthDescription = intl.formatMessage({ id: 'pages.auth.resident.description' })
    const LinkDativeMessage = intl.formatMessage({ id: 'pages.auth.resident.qrCode.info.link.dative' })
    const AuthFailedMessage = intl.formatMessage({ id: 'ServerError' })
    const QRCodeInfoMessage = intl.formatMessage({ id: 'pages.auth.resident.qrCode.info' }, {
        link: (
            <Typography.Link href={residentAppInfo?.mobile?.help || '#'} target='_blank'>
                {LinkDativeMessage}
            </Typography.Link>
        ),
    })

    const router = useRouter()
    const { query: { next } } = router
    const redirectUrl = (next && !Array.isArray(next) && isSafeUrl(next)) ? next : '/resident'

    const [step, setStep] = useState<'phone' | 'code'>('phone')
    const { token, identifier } = useRegisterContext()
    const { executeCaptcha } = useHCaptcha()
    const { refetch } = useAuth()

    const [authenticateOrRegisterUserWithToken] = useAuthenticateOrRegisterUserWithTokenMutation()

    const goToPhoneStep = useCallback(() => setStep('phone'), [])
    const goToCodeStep = useCallback(() => setStep('code'), [])

    const handlePhoneVerified = useCallback(async () => {
        try {
            const sender = getClientSideSenderInfo()
            const captcha = await executeCaptcha()

            const res = await authenticateOrRegisterUserWithToken({
                variables: {
                    data: {
                        dv: 1,
                        sender,
                        captcha,
                        token,
                        userType: UserTypeType.Resident,
                        userData: { phone: identifier },
                    },
                },
            })

            if (!res.errors && res.data?.result?.user?.id) {
                await refetch()
                await router.push(redirectUrl)
                return
            }
        } catch (error) {
            console.error('Resident authentication failed')
            console.error(error)
        }

        notification.error({ message: AuthFailedMessage })
        setStep('phone')
    }, [AuthFailedMessage, authenticateOrRegisterUserWithToken, executeCaptcha, identifier, redirectUrl, refetch, router, token])

    return (
        <>
            <Head><title>{ResidentAuthTitle}</title></Head>

            <Row justify='center'>
                <ResponsiveCol desktopWidth='422px' span={24}>
                    <Row justify='center' gutter={[0, 48]}>
                        {
                            step === 'phone' ? (
                                <Col span={24}>
                                    <Row gutter={[0, 24]}>
                                        <Col span={24}>
                                            <Typography.Title level={2}>
                                                {ResidentAuthTitle}
                                            </Typography.Title>
                                        </Col>
                                        <Col span={24}>
                                            <Typography.Text>
                                                {ResidentAuthDescription}
                                            </Typography.Text>
                                        </Col>
                                        <Col span={24}>
                                            <ResidentPhoneStep onFinish={goToCodeStep} />
                                        </Col>
                                    </Row>
                                </Col>
                            ) : (
                                <Col span={24}>
                                    <ValidateIdentifierForm
                                        title={ResidentAuthTitle}
                                        onFinish={handlePhoneVerified}
                                        onReset={goToPhoneStep}
                                    />
                                </Col>
                            )
                        }

                        {
                            step === 'phone' && hasResidentMobileApp && (
                                <Col span={24}>
                                    <Row gutter={[0, 24]} justify='center'>
                                        <Col>
                                            <QRCodeCanvas
                                                value={residentAppInfo.mobile.download}
                                                size={120}
                                                level='M'
                                            />
                                        </Col>
                                        <Col span={24}>
                                            <InfoBlock>
                                                <Typography.Text size='medium'>
                                                    {QRCodeInfoMessage}
                                                </Typography.Text>
                                            </InfoBlock>
                                        </Col>
                                    </Row>
                                </Col>
                            )
                        }
                    </Row>
                </ResponsiveCol>
            </Row>
        </>
    )
}

const ResidentAuthPage: PageComponentType = () => {
    useEffectOnce(() => {
        setCookie(AUTH_FLOW_USER_TYPE_COOKIE_NAME, 'resident', { maxAge: COOKIE_MAX_AGE_IN_SEC })
    })

    return (
        <RegisterContextProvider>
            <ResidentAuthForm />
        </RegisterContextProvider>
    )
}

ResidentAuthPage.container = AuthLayout
ResidentAuthPage.headerAction = <WelcomeHeaderTitle userType='resident' />
ResidentAuthPage.skipUserPrefetch = true

ResidentAuthPage.getPrefetchedData = async () => {
    return {
        props: {},
    }
}

export default ResidentAuthPage
