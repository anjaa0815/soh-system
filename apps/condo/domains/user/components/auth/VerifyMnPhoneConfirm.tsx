import React from 'react'

import { useIntl } from '@open-condo/next/intl'
import { Button, Space, Typography } from '@open-condo/ui'

import styles from './VerifyMnPhoneConfirm.module.css'


export type VerifyMnSession = {
    shortcode: string
    text: string
    smsUri?: string | null
    displayInstruction?: string | null
    status: string
}

type VerifyMnPhoneConfirmProps = {
    session: VerifyMnSession
}

/**
 * Phone confirmation with Verify.MN: the user sends the code by SMS to the short number
 * (the status is polled by the parent form, which completes the confirmation once it is VERIFIED)
 */
export const VerifyMnPhoneConfirm: React.FC<VerifyMnPhoneConfirmProps> = ({ session }) => {
    const intl = useIntl()
    const SendSmsLabel = intl.formatMessage({ id: 'pages.auth.verifyMn.sendSms' })
    const WaitingMessage = intl.formatMessage({ id: 'pages.auth.verifyMn.waiting' })
    const ExpiredMessage = intl.formatMessage({ id: 'pages.auth.verifyMn.expired' })
    const VerifiedMessage = intl.formatMessage({ id: 'pages.auth.verifyMn.verified' })
    const Instruction = intl.formatMessage({ id: 'pages.auth.verifyMn.instruction' }, { code: session.text, shortcode: session.shortcode })
    const PaidSmsNotice = intl.formatMessage({ id: 'pages.auth.verifyMn.paidSmsNotice' })

    const isExpired = session.status === 'EXPIRED'
    const isVerified = session.status === 'VERIFIED'

    return (
        <Space direction='vertical' size={16} width='100%'>
            <Typography.Text>{Instruction}</Typography.Text>
            <div className={styles.codeBox}>
                <Typography.Text type='secondary' size='small'>{session.shortcode}</Typography.Text>
                <span className={styles.code}>{session.text}</span>
            </div>
            {session.smsUri && !isExpired && !isVerified && (
                <a href={session.smsUri} className={styles.smsLink}>
                    <Button type='primary' block>{SendSmsLabel}</Button>
                </a>
            )}
            {session.displayInstruction && (
                <Typography.Text type='secondary' size='small'>{session.displayInstruction}</Typography.Text>
            )}
            <Typography.Text type={isExpired ? 'danger' : isVerified ? 'success' : 'secondary'} size='medium'>
                {isExpired ? ExpiredMessage : isVerified ? VerifiedMessage : WaitingMessage}
            </Typography.Text>
            <Typography.Text type='secondary' size='small'>{PaidSmsNotice}</Typography.Text>
        </Space>
    )
}
