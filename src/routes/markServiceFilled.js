const express = require("express");
const { google } = require("googleapis");
const path = require("path");
const { getActiveSpreadsheetId, getPreviousSpreadsheetId } = require("../config/spreadsheetCycle");

const router = express.Router();

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: scopes,
});

const sheets = google.sheets({ version: "v4", auth });
const CURRENT_SHEET_ID = getActiveSpreadsheetId();
const PREVIOUS_SHEET_ID = getPreviousSpreadsheetId();
const RANGE = "BrandInfo!A:R"; // Includes all columns up to Done (R)

// Normalize to last 10 digits
const normalizeNumber = (num) => (num ? String(num).replace(/\D/g, "").slice(-10) : "");

// Tab aliases per service (include common variants)
const SERVICE_TAB_ALIASES = {
  solutions: [
    "Solutions",
    "SOLUTIONS",
    "Solution",
    "SOLUTION",
    "Solutions Feedback",
    "SOLUTIONS FEEDBACK",
  ],
  media: [
    "Media",
    "MEDIA",
    "Media Feedback",
    "MEDIA FEEDBACK",
  ],
  tech: [
    "Tech",
    "TECH",
    "Technology",
    "TECHNOLOGY",
  ],
  seo: ["SEO", "Seo"],
  martech: ["MART-TECH", "MarTech", "MARTTECH", "MART TECH"],
  fluence: ["Fluence", "FLUENCE", "Fluence Feedback", "INFLUENCER", "Influencer"],
  smp: ["SMP", "smp"],
};

const t = (v) => (v === undefined || v === null ? "" : String(v).trim());

function nowInIST_ddmmyyyy_hhmmss() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  // Remove leading zeros for day/month, keep HH:mm:ss zero-padded
  const dd = String(Number(get("day")));
  const mm = String(Number(get("month")));
  const yyyy = get("year");
  const hh = get("hour");
  const min = get("minute");
  const ss = get("second");
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
}

// Find exact BrandInfo row indices (1-based) by matching phone in column C
async function findBrandInfoRowsByPhone(spreadsheetId, normalizedPhone) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "BrandInfo!A:R",
  });
  const rows = resp.data.values || [];
  const hits = [];
  // Start at index 1 to skip header; sheet row number is i+1
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const phoneVal = row[2] || ""; // Column C
    if (normalizeNumber(phoneVal) === normalizedPhone) hits.push(i + 1);
  }
  return hits;
}

async function tryGetSheetRows(spreadsheetId, possibleNames) {
  for (const name of possibleNames) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!A:Z` });
      const rows = resp.data.values || [];
      if (rows.length > 0) return { rows, name };
    } catch (_) {}
  }
  return null;
}

// Service display names in BrandInfo header row
const serviceHeaderNames = {
  solutions: "Solutions",
  media: "Media",
  tech: "Tech",
  seo: "SEO",
  martech: "MarTech",
  fluence: "Fluence",
  smp: "SMP",
};

function indexToA1Col(idx0) {
  let n = idx0 + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Detect the correct Filled column dynamically from BrandInfo headers for the given service
async function getFilledColumnForService(spreadsheetId, serviceKey) {
  const headersResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "BrandInfo!A1:Q1",
  });
  const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
  const svcHeader = serviceHeaderNames[serviceKey];
  if (!svcHeader) throw new Error("Unsupported service for header lookup");

  // find exact match for service header
  const svcIdx = headers.findIndex((h) => (h || "").toString().trim() === svcHeader);
  if (svcIdx === -1) throw new Error(`Service header '${svcHeader}' not found in BrandInfo header row`);
  const filledIdx0 = svcIdx + 1; // Filled column is immediately after service column
  const filledA1 = indexToA1Col(filledIdx0);
  return { filledIdx0, filledA1 };
}

async function getSheetIdByTitle(title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: CURRENT_SHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  const sh = (meta.data.sheets || []).find((s) => s.properties.title === title);
  if (!sh) throw new Error(`Sheet with title '${title}' not found`);
  return sh.properties.sheetId;
}

// POST /api/markServiceFilled
// Body: { number: string, service: "solutions"|"media"|"tech"|"seo"|"martech" }
router.post("/", async (req, res) => {
  const { number, service, previous, brand } = req.body || {};
  console.log("[markServiceFilled] incoming:", { number, service, previous, brand });
  if (!number || !service) {
    return res
      .status(400)
      .json({ message: "'number' and 'service' are required in body" });
  }

  const key = String(service).toLowerCase();
  if (!serviceHeaderNames[key]) {
    return res.status(400).json({
      message:
        "Invalid service. Use one of: solutions, media, tech, seo, martech, fluence, smp",
    });
  }

  try {
    // Normalize previous flag: accept boolean true or string "true" (case-insensitive)
    const prevFlag = typeof previous === "string" ? previous.toLowerCase() === "true" : previous === true;
    console.log("[markServiceFilled] resolved prevFlag=", prevFlag);
    // Optional: when previous flag is true, copy feedback rows from previous sheet's tab into current sheet's same tab
    if (prevFlag) {
      const prevSheetId = PREVIOUS_SHEET_ID;
      if (!prevSheetId) {
        console.log("[markServiceFilled] no PREVIOUS_SHEET_ID configured");
        return res.status(400).json({ message: "Previous spreadsheet not configured" });
      }
      const aliases = SERVICE_TAB_ALIASES[key];
      if (!aliases) {
        return res.status(400).json({ message: "Unsupported service tab for previous copy" });
      }

      console.log("[markServiceFilled] copy: trying aliases on prev sheet", { prevSheetId, aliases });
      const got = await tryGetSheetRows(prevSheetId, aliases);
      if (got) {
        const { rows, name: sourceTab } = got;
        console.log("[markServiceFilled] copy: found source tab", sourceTab, "rows:", rows.length);
        if (rows.length >= 2) {
          const headers = rows[0];
          // Robust header normalizer
          const normKey = (h) => t(h).replace(/[^a-z0-9]/gi, "").toLowerCase();
          // Phone column detection across common variants
          const phoneKeys = new Set([
            "whatsappnumber",
            "whatsappno",
            "whatsapp",
            "phonenumber",
            "phone",
            "mobilenumber",
            "mobile",
            "contactnumber",
            "contactno",
            "number",
          ]);
          const phoneCol = headers.findIndex((h) => phoneKeys.has(normKey(h)));
          // CreatedAt detection across common variants
          const createdKeys = new Set([
            "createdat",
            "created",
            "createdtime",
            "timestamp",
            "time",
            "datetime",
            "submittedat",
            "submittedon",
            "date",
          ]);
          const createdIdx = headers.findIndex((h) => createdKeys.has(normKey(h)));
          console.log("[markServiceFilled] copy: phoneCol=", phoneCol, "createdIdx=", createdIdx);
          if (phoneCol !== -1) {
            const needle = normalizeNumber(number);
            const matches = [];
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i] || [];
              const phoneVal = normalizeNumber(row[phoneCol] || "");
              if (phoneVal === needle) {
                const clone = row.slice();
                if (createdIdx >= 0) {
                  while (clone.length <= createdIdx) clone.push("");
                  // Prefix apostrophe to force text in Sheets and avoid serial conversion
                  clone[createdIdx] = `'${nowInIST_ddmmyyyy_hhmmss()}`;
                }
                matches.push(clone);
              }
            }
            console.log("[markServiceFilled] copy: matches found=", matches.length);
            if (matches.length > 0) {
              // Append into current sheet under the first alias that exists
              let targetTab = null;
              for (const alias of aliases) {
                try {
                  await sheets.spreadsheets.values.get({ spreadsheetId: CURRENT_SHEET_ID, range: `${alias}!A:A` });
                  targetTab = alias;
                  break;
                } catch (_) {}
              }
              if (!targetTab) {
                console.log("[markServiceFilled] copy: no target tab found in current sheet for aliases", aliases);
                return res.status(404).json({ message: `Target tab not found for service '${key}' in current sheet` });
              }
              console.log("[markServiceFilled] copy: appending to", { targetTab, currentSheet: CURRENT_SHEET_ID });
              await sheets.spreadsheets.values.append({
                spreadsheetId: CURRENT_SHEET_ID,
                range: `${targetTab}!A:Z`,
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
                resource: { values: matches },
              });
              console.log("[markServiceFilled] copy: appended rows=", matches.length);
            }
          }
        }
      } else {
        console.log("[markServiceFilled] copy: could not find any of aliases on previous sheet", aliases);
      }
      // Continue to marking filled regardless of whether matches existed
    }
    const needle = normalizeNumber(number);
    const filledCol = await getFilledColumnForService(CURRENT_SHEET_ID, key);

    const brandInfoResp = await sheets.spreadsheets.values.get({
      spreadsheetId: CURRENT_SHEET_ID,
      range: RANGE,
    });
    const rows = brandInfoResp.data.values || [];

    const normBrand = (v) => t(v).toLowerCase();
    const brandNeedle = brand ? normBrand(brand) : "";

    // Find the single best row to update
    // - If brand provided: first matching row where Filled != Y
    // - Else: first row for that phone where Filled != Y
    let targetRowNum = null; // 1-based
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const phoneVal = row[2] || "";
      if (normalizeNumber(phoneVal) !== needle) continue;
      if (brandNeedle && normBrand(row[0]) !== brandNeedle) continue;

      const cur = t(row[filledCol.filledIdx0]).toUpperCase();
      if (cur !== "Y") {
        targetRowNum = i + 1;
        break;
      }
    }

    console.log("[markServiceFilled] marking:", { needle, service: key, brand: brandNeedle || undefined, targetRowNum, filledCol });

    if (!targetRowNum) {
      // If brand filter was used, differentiate message a bit.
      return res.status(200).json({
        number: needle,
        service: key,
        brand: brand || undefined,
        updatedCount: 0,
        message: brandNeedle
          ? "No unmarked rows found for this number+brand for this service."
          : "No unmarked rows found for this number for this service.",
      });
    }

    const updates = [{
      range: `BrandInfo!${filledCol.filledA1}${targetRowNum}`,
      values: [["Y"]],
    }];
    const matchRowIndexes = [targetRowNum - 1];

    // Apply updates in CURRENT sheet
    console.log("[markServiceFilled] batchUpdate values:", updates.map(u => u.range));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: CURRENT_SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });

    // Do not write into PREVIOUS sheet; previous sheet is read-only per requirement

    // Color the filled cells green
    const sheetId = await getSheetIdByTitle("BrandInfo");
    const filledMeta = await getFilledColumnForService(CURRENT_SHEET_ID, key);
    console.log("[markServiceFilled] coloring rows:", { matchRowIndexes, colIndex: filledMeta.filledIdx0 });
    const requests = matchRowIndexes.map((i) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: i,
          endRowIndex: i + 1,
          startColumnIndex: filledMeta.filledIdx0,
          endColumnIndex: filledMeta.filledIdx0 + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.86, green: 1.0, blue: 0.86 },
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    }));

    if (requests.length > 0) {
      // Color in CURRENT sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: CURRENT_SHEET_ID,
        requestBody: { requests },
      });
      // Do not color previous sheet; keep previous workbook read-only
    }

    return res.status(200).json({
      number: needle,
      service: key,
      brand: brand || undefined,
      updatedCount: 1,
      updatedRows: [targetRowNum],
      message: `Marked ${key} Filled as 'Y' in current sheet and colored green.`,
    });
  } catch (error) {
    console.error("/api/markServiceFilled error:", error);
    return res
      .status(500)
      .json({ message: "Error marking service filled status.", error: error.message });
  }
});

module.exports = router;
