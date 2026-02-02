# Google Sheets Mapping Guide - New Cycle Setup

## Overview

Your application uses multiple Google Sheets for different purposes. When starting a new cycle, you need to update spreadsheet IDs in specific files.

---

## 📋 Current Spreadsheet IDs

### Cycle-Based Sheets (Dynamic - Changes Every Cycle)
These are managed in `src/config/spreadsheetCycle.js`:

**Current Active Cycle:**
- ID: `14_CTezwaYLLkhWX3hskm61zXp0sfrCDnIu7bsfZt36w`
- Used by: `getBrandInfo.js`, `markServiceFilled.js`, `copyFeedback.js`

**Previous Cycle:**
- ID: `1vKSxjnHKSKjc_iWD86W6xTF7bYNtYN8s5K75NNM8LrA`
- Used by: `copyFeedback.js` (for copying old data)

### Static Sheets (Never Change)
These sheets remain the same across cycles:

**Main Operations Sheet:**
- ID: `1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY`
- Purpose: Main data, CSAT, markFilled operations
- Used by: `markFilled.js`, `csatAverage.js`, `getMainData.js`, `checkId.js`, `sendany.js`, `response.js`, `userProfileManager.js`, `storeData.js`

**Training & Responses Sheet:**
- ID: `1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ`
- Purpose: Training data, user details, responses
- Used by: `training.js`, `userDetails.js`, `addotherdata.js`

**PDP (Product) Sheet:**
- ID: `11M2FpntvgnX-XmpWcYTD27XbbqIiGlheTFHZSpCvP1s`
- Purpose: Product responses and logs
- Used by: `PdpResponse.js`

---

## 🔄 When Starting a New Cycle

### Step 1: Update Cycle Configuration

**File:** `src/config/spreadsheetCycle.js`

**What to do:**
1. Add your new cycle spreadsheet ID to the end of the `SHEET_IDS` array
2. The last ID in the array is always the "active" cycle
3. The second-to-last ID is the "previous" cycle

**Example:**
```javascript
const SHEET_IDS = [
  // Oldest cycle
  "1vKSxjnHKSKjc_iWD86W6xTF7bYNtYN8s5K75NNM8LrA",
  // Previous cycle
  "14_CTezwaYLLkhWX3hskm61zXp0sfrCDnIu7bsfZt36w",
  // NEW CYCLE - Add your new spreadsheet ID here
  "YOUR_NEW_SPREADSHEET_ID_HERE",
];
```

### Step 2: Verify Sheet Structure

Your new cycle spreadsheet MUST have these tabs:
- `BrandInfo` - Contains brand and client information
- `Solutions` - Service feedback
- `Media` - Service feedback
- `Tech` - Service feedback
- `SEO` - Service feedback
- `MarTech` - Service feedback
- `Fluence` - Service feedback
- `SMP` - Service feedback

### Step 3: Share the New Sheet

Share your new cycle spreadsheet with the service account email:
- Email: `schbangbot-new@schbangbo.iam.gserviceaccount.com` (check your credentials file)
- Permission: **Editor**

---

## 📁 Complete File Mapping

### Files Using Cycle-Based Sheets (Auto-Updates via spreadsheetCycle.js)

| File | Spreadsheet | Purpose | Tabs Used |
|------|-------------|---------|-----------|
| `src/routes/getBrandInfo.js` | Active Cycle | Get brand information | BrandInfo |
| `src/routes/markServiceFilled.js` | Active + Previous | Mark service as filled | BrandInfo |
| `src/routes/copyFeedback.js` | Active + Previous | Copy feedback between cycles | Solutions, Media, Tech, SEO, MarTech, Fluence, SMP |

### Files Using Static Sheets (Manual Update Required if Sheet Changes)

#### Main Operations Sheet (`1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY`)

| File | Purpose | Tabs Used |
|------|---------|-----------|
| `src/routes/markFilled.js` | Mark brand info as filled | BrandInfo |
| `src/routes/csatAverage.js` | Calculate CSAT averages | Tech, Media, Solutions |
| `src/routes/getMainData.js` | Get main sheet data | MAIN |
| `src/routes/checkId.js` | Check client/schbanger ID | MainData |
| `src/routes/sendany.js` | Send any data | SendAny |
| `src/routes/response.js` | Store responses | Sheet1 |
| `src/lib/aires/userProfileManager.js` | Manage user profiles | BrandInfo |
| `src/routes/storeData.js` | Store data | Various |

#### Training & Responses Sheet (`1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ`)

| File | Purpose | Tabs Used |
|------|---------|-----------|
| `src/routes/training.js` | Store training data | Sheet2 |
| `src/routes/userDetails.js` | Store user feedback | Feedback |
| `src/routes/addotherdata.js` | Add response data | BrandInfo, Responses, ResponseLog, CSAT |

#### PDP Sheet (`11M2FpntvgnX-XmpWcYTD27XbbqIiGlheTFHZSpCvP1s`)

| File | Purpose | Tabs Used |
|------|---------|-----------|
| `src/routes/PdpResponse.js` | Product responses | Responses, log |

---

## ⚠️ Important Notes

### DO Update:
✅ `src/config/spreadsheetCycle.js` - Add new cycle ID to the array

### DON'T Update (Unless Sheet Actually Changes):
❌ `src/routes/markFilled.js` - Uses static main operations sheet
❌ `src/routes/training.js` - Uses static training sheet
❌ `src/routes/userDetails.js` - Uses static training sheet
❌ `src/routes/addotherdata.js` - Uses static training sheet
❌ `src/routes/csatAverage.js` - Uses static main operations sheet
❌ `src/routes/getMainData.js` - Uses static main operations sheet
❌ `src/routes/checkId.js` - Uses static main operations sheet
❌ `src/routes/PdpResponse.js` - Uses static PDP sheet

### Auto-Updates (No Action Needed):
🔄 `src/routes/getBrandInfo.js` - Automatically uses active cycle
🔄 `src/routes/markServiceFilled.js` - Automatically uses active + previous cycle
🔄 `src/routes/copyFeedback.js` - Automatically uses active + previous cycle

---

## 🧪 Testing After Update

After updating the cycle configuration:

1. **Restart your server:**
   ```bash
   npm start
   ```

2. **Test getBrandInfo endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/getBrandInfo \
     -H "Content-Type: application/json" \
     -d '{"number": "1234567890"}'
   ```

3. **Check logs** - Verify it's reading from the new spreadsheet

4. **Test copyFeedback** - Ensure it can copy from previous to new cycle

---

## 🔍 Quick Reference

**To add a new cycle:**
1. Open `src/config/spreadsheetCycle.js`
2. Add new spreadsheet ID to end of `SHEET_IDS` array
3. Share new sheet with service account email
4. Restart server
5. Test endpoints

**Current cycle ID:** Last item in `SHEET_IDS` array
**Previous cycle ID:** Second-to-last item in `SHEET_IDS` array

---

## 📞 Need Help?

If you're unsure which spreadsheet ID to use:
1. Open the Google Sheet in your browser
2. Look at the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit`
3. Copy the ID between `/d/` and `/edit`
