const express = require("express");
const { google } = require("googleapis");
const path = require("path");
const { getActiveSpreadsheetId, getPreviousSpreadsheetId } = require("../config/spreadsheetCycle");

const router = express.Router();

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
const scopes = ["https://www.googleapis.com/auth/spreadsheets"]; 

const auth = new google.auth.GoogleAuth({ keyFile: SERVICE_ACCOUNT_FILE, scopes });
const sheets = google.sheets({ version: "v4", auth });

const normalizeNumber = (num) => (num ? String(num).replace(/\D/g, "").slice(-10) : "");
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
  const dd = get("day");
  const mm = get("month");
  const yyyy = get("year");
  const hh = get("hour");
  const min = get("minute");
  const ss = get("second");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
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

const SERVICE_TAB_ALIASES = {
  solutions: ["Solutions", "SOLUTIONS"],
  media: ["Media", "MEDIA"],
  tech: ["Tech", "TECH"],
  seo: ["SEO", "Seo"],
  martech: ["MART-TECH", "MarTech", "MARTTECH"],
  fluence: ["Fluence", "FLUENCE"],
  smp: ["SMP"],
};

router.post("/", async (req, res) => {
  try {
    const { number, service } = req.body || {};
    if (!number || !service) return res.status(400).json({ message: "'number' and 'service' are required in body" });

    const key = String(service).toLowerCase();
    const aliases = SERVICE_TAB_ALIASES[key];
    if (!aliases) return res.status(400).json({ message: "Invalid service. Use: solutions, media, tech, seo, martech, fluence, smp" });

    const sourceSpreadsheetId = getActiveSpreadsheetId();
    const targetSpreadsheetId = getPreviousSpreadsheetId();
    if (!targetSpreadsheetId) return res.status(400).json({ message: "Previous spreadsheet not configured" });

    const got = await tryGetSheetRows(sourceSpreadsheetId, aliases);
    if (!got) return res.status(404).json({ message: `Source tab not found for service '${service}'` });
    const { rows, name: sourceTab } = got;
    if (rows.length < 2) return res.status(404).json({ message: "No data in source tab" });

    const headers = rows[0];
    const phoneCol = headers.findIndex((h) => t(h) === "Whatsapp Number");
    if (phoneCol === -1) return res.status(400).json({ message: "Whatsapp Number column not found in source" });

    const needle = normalizeNumber(number);
    const matched = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const phoneVal = normalizeNumber(row[phoneCol] || "");
      if (phoneVal === needle) matched.push(row);
    }

    if (matched.length === 0) return res.status(200).json({ copied: 0, message: "No matching rows found in source" });

    // Find CreatedAt column index (prefer exact 'CreatedAt', but be tolerant to spacing/case)
    const createdIdx = headers.findIndex((h) => t(h).replace(/\s+/g, "").toLowerCase() === "createdat");
    const nowIst = nowInIST_ddmmyyyy_hhmmss();

    // Build rows to append, overriding CreatedAt to current time
    const rowsToAppend = matched.map((r) => {
      const clone = Array.isArray(r) ? r.slice() : [];
      if (createdIdx >= 0) {
        // Ensure length
        while (clone.length <= createdIdx) clone.push("");
        clone[createdIdx] = nowIst;
      }
      return clone;
    });

    let targetTab = null;
    for (const alias of aliases) {
      try {
        await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId, ranges: [], includeGridData: false });
        await sheets.spreadsheets.values.get({ spreadsheetId: targetSpreadsheetId, range: `${alias}!A:Z` });
        targetTab = alias;
        break;
      } catch (_) {}
    }
    if (!targetTab) return res.status(404).json({ message: `Target tab not found for service '${service}'` });

    const appendResp = await sheets.spreadsheets.values.append({
      spreadsheetId: targetSpreadsheetId,
      range: `${targetTab}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values: rowsToAppend },
    });

    return res.status(200).json({ copied: rowsToAppend.length, service: key, sourceTab, targetTab, updates: appendResp.data.updates || {} });
  } catch (error) {
    return res.status(500).json({ message: "Error copying feedback", error: error.message });
  }
});

module.exports = router;
