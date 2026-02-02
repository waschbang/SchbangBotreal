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
const SPREADSHEET_ID = getActiveSpreadsheetId(); // Active spreadsheet for current cycle
const RANGE = "BrandInfo!A:R"; // Columns through 'Done' (R)

// Helper to normalize phone numbers to compare reliably (last 10 digits)
const normalizeNumber = (num) => (num ? String(num).replace(/\D/g, "").slice(-10) : "");

// Safe trim utility
const t = (v) => (v === undefined || v === null ? "" : String(v).trim());

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

      // Column mapping based on new layout with separate Filled columns and a final Done column
      const brand = t(row[0]); // A: Brands
      const brandPOCName = t(row[1]); // B: Brand POC Name
      const phone = t(row[2]); // C: Phone Number
      const solutions = t(row[3]); // D: Solutions
      const solutionsFilled = t(row[4]); // E: Solutions Filled (Y/N)
      const media = t(row[5]); // F: Media
      const mediaFilled = t(row[6]); // G: Media Filled (Y/N)
      const tech = t(row[7]); // H: Tech
      const techFilled = t(row[8]); // I: Tech Filled (Y/N)
      const seo = t(row[9]); // J: SEO
      const seoFilled = t(row[10]); // K: SEO Filled (Y/N)
      const marTech = t(row[11]); // L: MarTech
      const marTechFilled = t(row[12]); // M: MarTech Filled (Y/N)
      const fluence = t(row[13]); // N: Fluence
      const fluenceFilled = t(row[14]); // O: Fluence Filled (Y/N)
      const smp = t(row[15]); // P: SMP
      const smpFilled = t(row[16]); // Q: SMP Filled (Y/N)
      const done = t(row[17]); // R: Done

      if (normalizeNumber(phone) === needle) {
        records.push({
          brand,
          brandPOCName,
          phoneNumber: phone,
          solutions,
          solutionsFilled,
          media,
          mediaFilled,
          tech,
          techFilled,
          seo,
          seoFilled,
          marTech,
          marTechFilled,
          fluence,
          fluenceFilled,
          smp,
          smpFilled,
          done,
        });
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
