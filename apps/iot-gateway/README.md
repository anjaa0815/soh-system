# iot-gateway

Bridges building hardware — MQTT sensors, ONVIF cameras/NVRs (e.g. a gate's access-
control recorder), RS-485/Modbus meters — into the condo platform. condo itself never
speaks these protocols or listens for inbound device connections; this app is the piece
that does, translating hardware events into GraphQL calls against condo's own API.

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
| Parking (barrier / ALPR server) | `src/adapters/parkingAdapter.js` | Implemented against the parking server's third-party HTTP API. Endpoints, methods and response envelopes were **checked against a live parking server**; plate sync and entry/exit handling are covered by `npm test` against in-process fakes. **Not yet tested with real vehicles or a live condo instance** — see "Parking" below. |
| ONVIF (cameras/NVR) | `src/adapters/onvifAdapter.js` | Implemented against the `onvif` package's API, including multi-channel NVR support (`listChannels`, per-channel snapshot/stream URIs) — **not tested against real hardware**. Motion event topic names vary by manufacturer and must be verified against your specific camera/NVR model. |

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

## Deployment: runs on the compound's LAN

This gateway (and `OnvifAdapter` in particular) is meant to run **inside the
compound's own local network**, on the same LAN as the gate's NVR/cameras and any
RS-485 bus — not in condo's cloud, and not reachable from the internet. It only pushes
normalized, summarized data out (a meter reading, a "motion at the gate" event); it
never exposes the NVR, a raw camera stream, or the RS-485 bus to anything outside that
LAN. Concretely: a small on-site machine (or a container on one) runs
`npm start` with its `.env` pointed at `CONDO_API_URL=https://<your-condo-domain>/admin/api`
and `MQTT_BROKER_URL`/`ONVIF_CAMERAS`/`RS485_SERIAL_PORT` pointed at devices on that
same local network.

## Cameras: single camera vs NVR

`ONVIF_CAMERAS` accepts one entry per physical camera, or **one entry per NVR** — an
NVR is just an ONVIF device that reports multiple channels (one per camera plugged
into it) instead of one. `OnvifAdapter.start()` connects and calls
`onvifAdapter.listChannels()` to see what came back:

```js
[{ device: 'gate-nvr', profileToken: 'Profile_1', name: 'Гарц 1 - орох' },
 { device: 'gate-nvr', profileToken: 'Profile_2', name: 'Гарц 1 - гарах' }]
```

Motion events are tagged with `device`/`channel`/`profileToken` so a multi-channel NVR
can tell you *which* gate camera triggered, not just that "something" on the NVR did.

### From snapshots to live video

`OnvifAdapter.getSnapshotUri(device, profileToken)` and `.getStreamUri(...)` return
URIs the NVR itself serves (still needing its own auth to fetch) — this adapter doesn't
proxy or store images. Two very different levels of effort follow from there:

- **Snapshot polling** (cheap): have whatever displays camera state (a condo miniapp
  page, an internal dashboard) fetch the snapshot URI every few seconds. No new
  infrastructure — just an HTTP GET per refresh.
- **Live video in a browser** (real infrastructure): browsers can't play RTSP directly.
  `getStreamUri` returns an RTSP URL that needs transcoding — typically an `ffmpeg`
  process (or a service like `mediamtx`/`go2rtc`) converting RTSP to HLS or WebRTC,
  run somewhere reachable by whoever's viewing. This is a genuinely separate piece of
  infrastructure, not something this gateway does today.

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

## Parking

Connects a barrier-gate parking server (ALPR cameras, the "yard" server with its
`/yard/third` HTTP API) to condo, so that who may drive in is decided by condo's resident
data instead of a list someone maintains by hand at the gate.

What it does:

- **Resident plates -> barrier access.** Plates recorded on a condo `Contact` are
  registered in the parking server as monthly cars (`/monthRental`). Remove the plate,
  let it expire, or delete the contact, and the next sync cancels it (`/monthCancel`).
- **Entries and exits -> condo.** Entry/exit records are pulled every
  `PARKING_POLL_INTERVAL_MS`, de-duplicated, attributed to the resident who owns the
  plate, and (optionally) the last 20 are stored on that contact.
- **Occupancy.** `ParkingAdapter.getOccupancy()` returns free/total spaces.

It only ever cancels plates it issued itself (tracked in `parking-state.json`). Monthly
cars a cashier registered directly in the parking software are never touched.

### Where plates live in condo

condo has no vehicle model, and this adapter does not add one. Plates are stored in a
`CustomField` on the `Contact` model, which a B2BApp service user is allowed to read and
write. One-time setup, in the Keystone Admin UI:

1. Create a `CustomField`: `modelName: Contact`, `type: Json`, `isUniquePerObject: true`,
   `staffCanRead: true`, name e.g. "Машины дугаар". Its id goes in
   `PARKING_PLATES_CUSTOM_FIELD_ID`.
2. (Optional) Create a second one the same way, e.g. "Зогсоолын түүх", for
   `PARKING_HISTORY_CUSTOM_FIELD_ID`.
3. Give the gateway's `B2BAppAccessRightSet` read access to `Contact` and read/manage
   access to `CustomValue`, and put the B2BApp's id in `CONDO_B2B_APP_ID`.

A value is a list of plates, optionally with an expiry:

```json
[{ "plate": "1234УБА" }, { "plate": "5678УНА", "validUntil": "2026-12-31" }]
```

Only a B2BApp service user (or an admin) can write CustomValues — staff cannot edit them
in the condo UI today. Until a miniapp screen exists for that, load plates with:

```bash
npm run parking:import -- vehicles.csv --dry-run   # phone,plate[,validUntil]
npm run parking:import -- vehicles.csv
```

### Running it

```bash
# .env: PARKING_ENABLED=true, PARKING_API_URL, PARKING_PLATES_CUSTOM_FIELD_ID, CONDO_*
npm run parking:check   # read-only: proves both sides are reachable, changes nothing
npm test                # the whole pipeline against in-process fakes
npm start
```

### Security

The parking server's third-party API has **no authentication** and includes a command
that opens the barrier. Anyone who can reach that port can open the gate. Keep the
parking server and this gateway on an isolated LAN/VLAN, never port-forward it, and keep
guest Wi-Fi off that network. This adapter intentionally does not implement gate
opening; if you add it, put it behind condo's own permission checks first.

### What is still unverified

- `/monthRental`'s body (`carNum`, `name`, `phone`, `department`, `carType`, `startDate`,
  `endDate`, `chargeMoney`, `payType`) was derived from the parking server's own model,
  not from documentation. Issue one test plate and confirm it appears under monthly cars.
- The field names read from entry/exit rows (`carNo`, `time`, `leaveTime`, `enterPass`,
  `leavePass`) have not been seen with real traffic — `npm run parking:check` prints a
  raw sample row to compare.
- The condo GraphQL calls were written against the schema in this repository and tested
  against a fake, not against a running condo.
