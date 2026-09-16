import getConfig from 'next/config'
import React, { useEffect, useRef } from 'react'

const {
    publicRuntimeConfig: { serverUrl },
} = getConfig()

type TelegramAuthData = {
    id: string
    first_name?: string
    last_name?: string
    username?: string
    photo_url?: string
    auth_date: string
    hash: string
}

type TelegramLoginButtonProps = {
    botName: string
    userType: 'staff' | 'resident' | 'service'
    redirectUrl: string
    size?: 'large' | 'medium' | 'small'
}

// NOTE: window.onTelegramAuth is Telegram's own callback-name convention for the login widget
// (https://core.telegram.org/widgets/login) - it's a global by design, not something we can scope.
declare global {
    interface Window {
        onTelegramAuth?: (user: TelegramAuthData) => void
    }
}

export const TelegramLoginButton: React.FC<TelegramLoginButtonProps> = ({ botName, userType, redirectUrl, size = 'large' }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!botName || !containerRef.current) return

        window.onTelegramAuth = (user: TelegramAuthData) => {
            const tgAuthData = new URLSearchParams({
                id: user.id,
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                username: user.username || '',
                photo_url: user.photo_url || '',
                auth_date: user.auth_date,
                hash: user.hash,
            }).toString()

            const authUrl = new URL('/api/tg/auth', serverUrl)
            authUrl.searchParams.set('userType', userType)
            authUrl.searchParams.set('redirectUrl', encodeURIComponent(redirectUrl))
            authUrl.searchParams.set('tgAuthData', encodeURIComponent(tgAuthData))

            window.location.href = authUrl.toString()
        }

        const script = document.createElement('script')
        script.src = 'https://telegram.org/js/telegram-widget.js?22'
        script.async = true
        script.setAttribute('data-telegram-login', botName)
        script.setAttribute('data-size', size)
        script.setAttribute('data-onauth', 'onTelegramAuth(user)')
        script.setAttribute('data-request-access', 'write')

        containerRef.current.appendChild(script)

        return () => {
            delete window.onTelegramAuth
        }
    }, [botName, userType, redirectUrl, size])

    if (!botName) return null

    return <div ref={containerRef} />
}
