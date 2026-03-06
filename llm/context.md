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
