const express = require("express");
const { google } = require("googleapis");
const { getGoogleSheets } = require("../lib/googleAuth");
const { getActiveSpreadsheetId, getPreviousSpreadsheetId } = require("../config/spreadsheetCycle");

const router = express.Router();

const sheets = getGoogleSheets();
const SPREADSHEET_ID = getActiveSpreadsheetId(); // Active spreadsheet for current cycle
const RANGE = "BrandInfo!A:BF"; // Columns A through Done (BF)

// Helper to normalize phone numbers to compare reliably (last 10 digits)
const normalizeNumber = (num) => (num ? String(num).replace(/\D/g, "").slice(-10) : "");

// Safe trim utility
const t = (v) => (v === undefined || v === null ? "" : String(v).trim());

// -------------------------------------------------------------------
// Data-driven column definitions (index → field key)
// Each department has two consecutive columns: dept (Y/N) + deptFilled (Y/N)
// -------------------------------------------------------------------
const COLUMNS = [
  { idx: 0, key: "brand" },
  { idx: 1, key: "brandPOCName" },
  { idx: 2, key: "phoneNumber" },
  // -- Departments (Y/N) + Filled (Y/N) --
  { idx: 3, key: "solutions" },
  { idx: 4, key: "solutionsFilled" },
  { idx: 5, key: "fluence" },
  { idx: 6, key: "fluenceFilled" },
  { idx: 7, key: "smp" },
  { idx: 8, key: "smpFilled" },
  { idx: 9, key: "media" },
  { idx: 10, key: "mediaFilled" },
  { idx: 11, key: "tech" },
  { idx: 12, key: "techFilled" },
  { idx: 13, key: "design" },
  { idx: 14, key: "designFilled" },
  { idx: 15, key: "development" },
  { idx: 16, key: "developmentFilled" },
  { idx: 17, key: "designDevelopment" },
  { idx: 18, key: "designDevelopmentFilled" },
  { idx: 19, key: "seoContent" },
  { idx: 20, key: "seoContentFilled" },
  { idx: 21, key: "seo" },
  { idx: 22, key: "seoFilled" },
  { idx: 23, key: "content" },
  { idx: 24, key: "contentFilled" },
  { idx: 25, key: "seoPlusContent" },
  { idx: 26, key: "seoPlusContentFilled" },
  { idx: 27, key: "aso" },
  { idx: 28, key: "asoFilled" },
  { idx: 29, key: "backlinks" },
  { idx: 30, key: "backlinksFilled" },
  { idx: 31, key: "gmb" },
  { idx: 32, key: "gmbFilled" },
  { idx: 33, key: "geoAio" },
  { idx: 34, key: "geoAioFilled" },
  { idx: 35, key: "croGrowth" },
  { idx: 36, key: "croGrowthFilled" },
  { idx: 37, key: "marTech" },
  { idx: 38, key: "marTechFilled" },
  { idx: 39, key: "socialListening" },
  { idx: 40, key: "socialListeningFilled" },
  { idx: 41, key: "performanceCreatives" },
  { idx: 42, key: "performanceCreativesFilled" },
  { idx: 43, key: "wa" },
  { idx: 44, key: "waFilled" },
  { idx: 45, key: "emailMarketing" },
  { idx: 46, key: "emailMarketingFilled" },
  { idx: 47, key: "orm" },
  { idx: 48, key: "ormFilled" },
  { idx: 49, key: "marketingAutomation" },
  { idx: 50, key: "marketingAutomationFilled" },
  { idx: 51, key: "chatbotCreation" },
  { idx: 52, key: "chatbotCreationFilled" },
  { idx: 53, key: "zohoCrm" },
  { idx: 54, key: "zohoCrmFilled" },
  { idx: 55, key: "aPlusListings" },
  { idx: 56, key: "aPlusListingsFilled" },
  // -- Final status column --
  { idx: 57, key: "done" },
];

// Build a header index map for a row of headers
function buildHeaderIdx(headers) {
  const map = {};
  (headers || []).forEach((h, i) => {
    const key = t(h);
    if (key) map[key] = i;
  });
  return map;
}

// Try a list of possible sheet tab names in order until one works
async function tryGetSheetRows(spreadsheetId, possibleNames) {
  for (const name of possibleNames) {
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${name}!A:Z`,
      });
      const rows = resp.data.values || [];
      if (rows.length > 0) return { rows, name };
    } catch (e) {
      // continue trying next alias
    }
  }
  return null;
}

// Generic reader for a sheet tab to fetch previous cycle response by whatsapp number
async function fetchPrevResponse(spreadsheetId, sheetAliases, phone) {
  try {
    if (!spreadsheetId) return null;
    const got = await tryGetSheetRows(spreadsheetId, sheetAliases);
    if (!got) return null;
    const { rows } = got;
    if (rows.length < 2) return null;
    const headers = rows[0];
    const H = buildHeaderIdx(headers);

    // Required columns
    const phoneCol = H["Whatsapp Number"];
    if (phoneCol === undefined) return null;

    const needle = normalizeNumber(phone);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const phoneVal = normalizeNumber(row[phoneCol] || "");
      if (phoneVal !== needle) continue;

      // NPS from 'Recommendation Likelihood' with alias fallback 'Likelihood To Recommend'
      const nps =
        t(row[H["Recommendation Likelihood"] ?? -1]) ||
        t(row[H["Likelihood To Recommend"] ?? -1]);

      // Compute CSAT as average of all numeric scores in the row (exclude phone, createdAt, comments)
      let sum = 0;
      let count = 0;
      for (let c = 0; c < row.length; c++) {
        if (c === phoneCol) continue;
        const header = headers[c] ? String(headers[c]).trim() : "";
        if (!header) continue;
        if (header.toLowerCase().includes("additional comment") || header.toLowerCase() === "createdat") continue;
        const val = parseFloat(String(row[c]).trim());
        if (Number.isFinite(val)) {
          sum += val;
          count += 1;
        }
      }
      const csat = count > 0 ? (sum / count).toFixed(2) : "";

      const additionalComment = t(row[H["Additional Comments"] ?? -1]);

      if (!csat && !nps && !additionalComment) return null;
      return { csat, nps, additionalComment };
    }
    return null;
  } catch (e) {
    // Silently ignore if sheet/tab missing or permission issue for previous cycle
    return null;
  }
}

// POST route to get brand information based on phone number
router.post("/", async (req, res) => {
  const { number } = req.body;

  if (!number) {
    return res.status(400).json({ message: "'number' is required in body" });
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values || [];

    // Skip header row and collect all matching records
    const needle = normalizeNumber(number);
    const records = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const phone = t(row[2]); // Column C: Phone Number

      if (normalizeNumber(phone) === needle) {
        // Build record dynamically from COLUMNS definition
        const record = {};
        for (const col of COLUMNS) {
          record[col.key] = t(row[col.idx]);
        }
        records.push(record);
      }
    }

    // Build previous cycle object by looking up each department tab in previous sheet
    const prevSheetId = getPreviousSpreadsheetId();
    const prevCycle = {};

    if (prevSheetId) {
      const [psolution, pmedia, ptech, pseo, pmartech, pfluence, psmp] = await Promise.all([
        fetchPrevResponse(prevSheetId, ["Solutions", "SOLUTIONS"], number),
        fetchPrevResponse(prevSheetId, ["Media", "MEDIA"], number),
        fetchPrevResponse(prevSheetId, ["Tech", "TECH"], number),
        fetchPrevResponse(prevSheetId, ["SEO", "Seo"], number),
        fetchPrevResponse(prevSheetId, ["MART-TECH", "MarTech", "MARTTECH"], number),
        fetchPrevResponse(prevSheetId, ["Fluence", "FLUENCE"], number),
        fetchPrevResponse(prevSheetId, ["SMP"], number),
      ]);

      if (psolution) prevCycle.psolution = { present: true, ...psolution };
      if (pmedia) prevCycle.pmedia = { present: true, ...pmedia };
      if (ptech) prevCycle.ptech = { present: true, ...ptech };
      if (pseo) prevCycle.pseo = { present: true, ...pseo };
      if (pmartech) prevCycle.pmartech = { present: true, ...pmartech };
      if (pfluence) prevCycle.pfluence = { present: true, ...pfluence };
      if (psmp) prevCycle.psmp = { present: true, ...psmp };
    }

    const hasPrev = Object.keys(prevCycle).length > 0;

    return res.status(200).json({
      number: normalizeNumber(number),
      count: records.length,
      records,
      previous: hasPrev ? true : false,
      previouscycle: hasPrev ? prevCycle : undefined,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error retrieving brand information.");
  }
});

module.exports = router;
