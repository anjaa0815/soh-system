import styled from '@emotion/styled'
import { Col, Row } from 'antd'
import { useRouter } from 'next/router'
import React, { useCallback } from 'react'

import { useAuth } from '@open-condo/next/auth'
import { useIntl } from '@open-condo/next/intl'
import { Button, Typography } from '@open-condo/ui'
import { colors } from '@open-condo/ui/colors'

import { Logo } from '@condo/domains/common/components/Logo'
import { formatPhone } from '@condo/domains/common/utils/helpers'


const HeaderWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid ${colors.gray[3]};
`

const ContentWrapper = styled.div`
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 24px;
`

const ResidentLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
    const intl = useIntl()
    const SignOutMessage = intl.formatMessage({ id: 'SignOut' })

    const router = useRouter()
    const { user, signOut } = useAuth()

    const handleSignOut = useCallback(async () => {
        await signOut()
        await router.push('/auth/resident')
    }, [router, signOut])

    return (
        <>
            <HeaderWrapper>
                <Logo />
                <Row align='middle' gutter={16}>
                    {
                        user?.phone && (
                            <Col>
                                <Typography.Text type='secondary'>
                                    {formatPhone(user.phone)}
                                </Typography.Text>
                            </Col>
                        )
                    }
                    <Col>
                        <Button type='secondary' size='small' onClick={handleSignOut}>
                            {SignOutMessage}
                        </Button>
                    </Col>
                </Row>
            </HeaderWrapper>
            <ContentWrapper>
                {children}
            </ContentWrapper>
        </>
    )
}

export default ResidentLayout
