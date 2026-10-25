// Mirrors apps/condo/domains/meter/constants/constants.js — these ids are fixed seed data
// in condo's database, not something this gateway can invent, so keep this list in sync
// with that file if condo ever adds/renames a resource.
const METER_RESOURCE_IDS = {
    coldWater: 'e2bd70ac-0630-11ec-9a03-0242ac130003',
    hotWater: '0f54223c-0631-11ec-9a03-0242ac130003',
    electricity: '139a0d98-0631-11ec-9a03-0242ac130003',
    heatSupply: '18555734-0631-11ec-9a03-0242ac130003',
    gasSupply: '1c267e92-0631-11ec-9a03-0242ac130003',
    coldAir: '4cb94217-14cb-4897-8b8f-891b781a1896',
    drainage: 'ffc3f0c3-5044-4093-93ce-d7e92176dfe2',
}

function resolveMeterResourceId (resource) {
    const id = METER_RESOURCE_IDS[resource]
    if (!id) {
        throw new Error(`Unknown meter resource "${resource}". Known resources: ${Object.keys(METER_RESOURCE_IDS).join(', ')}`)
    }
    return id
}

module.exports = { METER_RESOURCE_IDS, resolveMeterResourceId }
