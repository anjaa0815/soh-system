/**
 * Verify.MN: phone number verification by an SMS sent BY THE USER (mobile originated).
 * Instead of sending the confirmation code by SMS, the code is shown to the user, who sends it
 * from their phone to the Verify.MN short number. The phone is verified once Verify.MN reports
 * the session as VERIFIED (the SMS came from that very number), so typing the code is not a proof here.
 *
 * Enabled when VERIFY_MN_API_KEY is set. Docs: https://verify.mn/app/docs/
 */
const conf = require('@open-condo/config')
const { fetch } = require('@open-condo/keystone/fetch')
const { getKVClient } = require('@open-condo/keystone/kv')
const { getLogger } = require('@open-condo/keystone/logging')

const logger = getLogger()

const API_URL = conf.VERIFY_MN_API_URL || 'https://api.verify.mn'
const VERIFIED_STATUS = 'VERIFIED'
const SESSION_KEY_PREFIX = 'verify-mn:confirm-phone:'
const MONGOLIA_PHONE_PREFIX = '+976'

function isVerifyMnEnabled () {
    return Boolean(conf.VERIFY_MN_API_KEY)
}

function toLocalPhone (normalizedPhone) {
    return normalizedPhone.startsWith(MONGOLIA_PHONE_PREFIX) ? normalizedPhone.slice(MONGOLIA_PHONE_PREFIX.length) : normalizedPhone.replace(/^\+/, '')
}

/**
 * Creates a Verify.MN session for the confirm phone action token: the user has to send `code` from `phone`
 * @returns {Promise<{ sessionId: string, shortcode: string, text: string, smsUri: string, displayInstruction: string, expiresAt: string }>}
 */
async function startVerifyMnSession ({ token, phone, code, ttlInSec }) {
    const response = await fetch(`${API_URL}/sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${conf.VERIFY_MN_API_KEY}`,
        },
        body: JSON.stringify({ phone: toLocalPhone(phone), text: String(code) }),
    })
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        logger.error({ msg: 'verify.mn session was not created', status: response.status, data: { body } })
        throw new Error(`verify.mn responded with ${response.status}`)
    }
    const session = await response.json()
    const stored = {
        sessionId: session.sessionId,
        shortcode: session.shortcode,
        text: session.text,
        smsUri: session.smsUri,
        displayInstruction: session.displayInstruction,
        expiresAt: session.expiresAt,
    }
    await getKVClient().set(`${SESSION_KEY_PREFIX}${token}`, JSON.stringify(stored), 'EX', ttlInSec)
    return stored
}

/**
 * @returns {Promise<null | { sessionId, shortcode, text, smsUri, displayInstruction, expiresAt }>} session of the token, if any
 */
async function getVerifyMnSession (token) {
    const stored = await getKVClient().get(`${SESSION_KEY_PREFIX}${token}`)
    return stored ? JSON.parse(stored) : null
}

/**
 * @returns {Promise<string>} PENDING | VERIFIED | EXPIRED
 */
async function getVerifyMnSessionStatus (sessionId) {
    const response = await fetch(`${API_URL}/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' })
    if (!response.ok) {
        logger.warn({ msg: 'verify.mn session status request failed', status: response.status, entityId: sessionId, entity: 'VerifyMnSession' })
        return 'PENDING'
    }
    const { sessionStatus } = await response.json()
    return sessionStatus
}

module.exports = {
    isVerifyMnEnabled,
    startVerifyMnSession,
    getVerifyMnSession,
    getVerifyMnSessionStatus,
    VERIFY_MN_VERIFIED_STATUS: VERIFIED_STATUS,
}
