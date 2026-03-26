# Context — Changes Log

## 2026-03-06 — Beer Claim API (SchbangParty)

### Added
- **`src/routes/schbangparty/beerClaim.js`** — Two endpoints for event beer claiming:
  - `GET /user/:zohoId` — Fetch user data from User Directory Google Sheet by Zoho ID. Returns name, contact, photo, and current claim count.
  - `POST /claim` — Record a beer claim. Accepts `{ zohoId, claimNumber }`. Creates a new row in Beer Claims sheet if first-time user (fetches user data from User Directory), or updates existing row. Enforces max 2 claims per user.

### Modified
- **`src/index.js`** — Imported and registered `beerClaimRoute` at `/schbangparty/api/beer`.

### Notes
- Google Sheet IDs in `beerClaim.js` are **placeholders** (`YOUR_USER_DIRECTORY_SPREADSHEET_ID` and `YOUR_BEER_CLAIMS_SPREADSHEET_ID`) — need to be replaced with real IDs.
- Service account `schbangbot-new@schbangbo.iam.gserviceaccount.com` must have Editor access on both sheets.

## 2026-03-20 — getBrandInfo Flow Walkthrough

### Added
- **`llm/getBrandInfo_flow.md`** — Detailed markdown walkthrough of the `POST /` endpoint in `src/routes/getBrandInfo.js`. Covers: needle normalization, column mapping (A–R), what `records[].solutions` actually returns (person name, not boolean), the `*Filled` Y/N fields, previous cycle lookup logic, and a visual flow diagram.

## 2026-03-20 — CSAT API Column Expansion (A:R → A:BH)

### Modified
- **`src/routes/getBrandInfo.js`** — Expanded from 18 columns (A:R) to 60 columns (A:BH). Replaced hardcoded per-column variable extraction with a data-driven `COLUMNS` array and dynamic record builder loop. Added 21 new department pairs (Y/N + Filled). Done column moved from R to BH.
- **`src/routes/markServiceFilled.js`** — Expanded `serviceHeaderNames` from 8 to 28 services. Added tab aliases for all new departments. Updated all ranges (`RANGE`, `findBrandInfoRowsByPhone`, `getFilledColumnForService` header scan) from A:R / A1:Q1 to A:BH / A1:BH1. Removed unused `markaas` service. Error message now dynamically lists all valid service keys.
- **`src/config/spreadsheetCycle.js`** — Updated current cycle spreadsheet ID to `1r3yab4vRj1GzwM7u2zmKkfiUmMMQa50rfMBaxsLF-2M`.


