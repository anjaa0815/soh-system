# iot-gateway

Bridges building hardware — MQTT sensors, ONVIF IP cameras, RS-485/Modbus meters — into
the condo platform. condo itself never speaks these protocols or listens for inbound
device connections; this app is the piece that does, translating hardware events into
GraphQL calls against condo's own API.

## Why a separate app

condo's "acquiring"/"meter integration" style extensions are always the caller: a
`B2BApp` registers a service user, gets an `Authorization: Bearer <token>`-authenticated
GraphQL client, and pushes data in (see `registerMetersReadings` in
`apps/condo/domains/meter/schema/RegisterMetersReadingsService.js`). There is no generic
"call me when a sensor fires" webhook on the condo side. So a hardware bridge has to run
as its own process/service, exactly like this one.

## Status of each adapter

| Adapter | File | Status |
|---|---|---|
| MQTT | `src/adapters/mqttAdapter.js` | Fully implemented, end-to-end tested (see `demo/`) against a real MQTT broker and a live condo instance. |
| RS-485 / Modbus | `src/adapters/rs485Adapter.js` | Implemented against the `modbus-serial` API, **not tested against real hardware** — register addresses/scaling are illustrative and must be adjusted to your meters' actual Modbus map. |
| ONVIF (cameras) | `src/adapters/onvifAdapter.js` | Implemented against the `onvif` package's API, **not tested against a real camera** — event topic names vary by manufacturer and must be verified against your specific camera model. |

## Two kinds of meter reading

condo distinguishes a resident's own metered account from a whole-building meter, and
this gateway follows the same split — set `scope: 'unit'` (default) or `scope: 'property'`
on a `RawReading` (see `src/normalizers/toMeterReading.js`):

- **`unit`** — a resident's own meter, billed to their account (`unitName` +
  `accountNumber` required). Calls `registerMetersReadings`.
- **`property`** — a meter for the whole building that the HOA itself pays for: the
  entrance hallway/elevator electricity, the common water riser, a gate barrier's power
  supply. No unit or account involved. Calls `registerPropertyMetersReadings` against
  condo's `PropertyMeter` model ("Resource meter installed on the entire apartment
  building").

## Setup

```bash
npm install --no-workspaces   # see note below on why --no-workspaces
cp .env.example .env
# fill in CONDO_API_URL, CONDO_SERVICE_TOKEN, CONDO_ORGANIZATION_ID, and whichever
# of MQTT_*/RS485_*/ONVIF_* your deployment needs
npm start
```

> This app sits under `apps/*`, which the repo root's `package.json` lists as a yarn
> workspace. Plain `npm install` here will otherwise try to resolve the whole monorepo
> (including Yarn Berry's `catalog:` version specifiers, which npm doesn't understand)
> — hence `--no-workspaces`. It was kept independent of the yarn/turbo build pipeline
> on purpose, since it's meant to be deployable on its own, separate from condo.

## Getting a service token

The production-correct way to authenticate is a `B2BApp` service user:

1. In condo, register a `B2BApp` (Keystone Admin UI, or a migration/seed script).
2. Create a `B2BAppContext` linking that app to the target `Organization`.
3. Create a `B2BAppAccessRightSet` of type `SCOPED` on that app with the permissions
   this gateway needs (at minimum, whatever backs `registerMetersReadings` — check
   `apps/condo/domains/meter/access/RegisterMetersReadingsService.js`).
4. Create a `B2BAccessToken` linking the context + right set + service user. Its
   `token` field (shown only once) is what goes in `CONDO_SERVICE_TOKEN`.

## From demo to production

`demo/run-mqtt-demo.js` authenticates via a plain staff phone+password login
(`authenticateUserWithPhoneAndPassword`) instead of the B2BAccessToken flow above,
purely because it's much faster to spin up for a demo — both return the same kind of
bearer token, so `CondoClient` itself needed no demo-specific branching. Do not run a
long-lived gateway against a staff login in production: mint a proper B2BApp service
token as described above, scoped to only the permissions this gateway actually needs.

To rerun the demo yourself (proves the MQTT → condo pipeline for real, no external
broker or hardware needed — it spins up an in-process Aedes broker):

```bash
npm install --no-workspaces
cp demo/.env.demo.example demo/.env.demo   # fill in a real staff login + organization + property address
npm run demo
```

### A known limitation of this demo

The demo also publishes 2 `scope: 'property'` (common-area) readings, and these are
expected to fail locally with "Property not found" — logged as a warning, not treated
as a demo failure. Root cause, traced by hand: `registerPropertyMetersReadings` has no
`unitName`/`unitType` in its `addressInfo` input (unlike `registerMetersReadings`), so
condo's `PropertyResolver` takes a different internal branch that re-parses the address
string through `AddressFromStringParser` before looking it up — and the parsed form
isn't guaranteed to be byte-identical to the raw address text a `Property` was created
with. Against a real address service that resolves both forms to the same canonical
address (its entire job), this is a non-issue. Against condo's local dev
`FakeAddressServiceClient` (`FAKE_ADDRESS_SERVICE_CLIENT=true`, a literal-string cache
with no real geocoding), a parsed form that isn't byte-identical to the original
produces a fresh, non-matching cache entry — hence "not found". This is a condo-side
quirk of testing against the fake client, not a bug in this gateway's request, which
was built and verified field-for-field against `RegisterPropertyMetersReadingsService.js`'s
actual GraphQL schema.

## Wiring camera events to condo

`OnvifAdapter` emits a `motionEvent`, but there's no `createCameraTicket`-style
mutation in condo — what should happen when a camera sees motion (open a ticket? which
classifier? which property/unit?) is organization-specific. `Bridge.useCameraAdapter`
takes a callback for exactly this reason; wire it to whatever mutation fits your
organization's ticket classifiers once you have real cameras to test against.

## Architecture

```
adapters/mqttAdapter.js   ─┐
adapters/rs485Adapter.js  ─┼─► Bridge ─► normalizers/toMeterReading.js ─► CondoClient ─► condo GraphQL API
adapters/onvifAdapter.js  ─┘        (motionEvent: caller-supplied handler, no generic mutation exists)
```

Each adapter only knows its own protocol and emits a small, protocol-agnostic event
shape (`reading` for meters, `motionEvent` for cameras). `Bridge` is the only piece
that knows about condo's mutations, via `CondoClient`. This keeps "add a new protocol"
and "change how condo is called" as independent changes.
