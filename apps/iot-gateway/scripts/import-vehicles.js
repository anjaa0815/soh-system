/**
 * Bulk-loads licence plates onto condo Contacts from a CSV, so a compound can be
 * onboarded from the list its security desk already keeps.
 *
 *   npm run parking:import -- vehicles.csv [--dry-run]
 *
 * CSV columns (header row required): phone,plate[,validUntil]
 *   +97699112233,1234УБА
 *   +97699112233,5678УНА,2026-12-31
 *
 * A contact is matched by phone inside CONDO_ORGANIZATION_ID. Rows whose phone matches
 * no contact, or more than one, are reported and skipped — nothing is guessed. All of a
 * contact's rows replace that contact's current plate list.
 */
const fs = require('fs')

const { CondoClient } = require('../src/condoClient')
const { config } = require('../src/config')
const { normalizePlate } = require('../src/parking/plates')

function parseCsv (text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const header = lines.shift().split(',').map((cell) => cell.trim().toLowerCase())
    const column = (name) => header.indexOf(name)
    if (column('phone') < 0 || column('plate') < 0) throw new Error('CSV needs "phone" and "plate" columns')
    return lines.map((line, index) => {
        const cells = line.split(',').map((cell) => cell.trim())
        return { line: index + 2, phone: cells[column('phone')], plate: normalizePlate(cells[column('plate')]), validUntil: column('validuntil') >= 0 ? (cells[column('validuntil')] || null) : null }
    })
}

async function main () {
    const args = process.argv.slice(2)
    const dryRun = args.includes('--dry-run')
    const file = args.find((arg) => !arg.startsWith('--'))
    if (!file) throw new Error('usage: npm run parking:import -- vehicles.csv [--dry-run]')
    if (!config.parking.platesCustomFieldId) throw new Error('PARKING_PLATES_CUSTOM_FIELD_ID is not set')

    const rows = parseCsv(fs.readFileSync(file, 'utf8'))
    const byPhone = new Map()
    for (const row of rows) {
        if (row.plate.length < 4) { console.warn(`line ${row.line}: invalid plate, skipped`); continue }
        if (!byPhone.has(row.phone)) byPhone.set(row.phone, [])
        byPhone.get(row.phone).push({ plate: row.plate, ...(row.validUntil ? { validUntil: row.validUntil } : {}) })
    }

    const condoClient = new CondoClient(config.condo)
    let written = 0, skipped = 0
    for (const [phone, plates] of byPhone) {
        const contacts = await condoClient.findContactsByPhone(phone)
        if (contacts.length !== 1) {
            console.warn(`${phone}: ${contacts.length === 0 ? 'no contact found' : `${contacts.length} contacts share this phone`}, skipped`)
            skipped++
            continue
        }
        console.log(`${phone} -> ${contacts[0].name || contacts[0].id}: ${plates.map((item) => item.plate).join(', ')}${dryRun ? '  (dry run)' : ''}`)
        if (!dryRun) {
            await condoClient.upsertCustomValue({ customFieldId: config.parking.platesCustomFieldId, objectId: contacts[0].id, data: plates, b2bAppId: config.condo.b2bAppId })
        }
        written++
    }
    console.log(`\n${dryRun ? 'would write' : 'wrote'} ${written} contact(s), skipped ${skipped}`)
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1) })
