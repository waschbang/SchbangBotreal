const express = require("express");
const { google } = require("googleapis");
const { getGoogleSheets } = require("../lib/googleAuth");

const router = express.Router();

const sheets = getGoogleSheets();
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY";
const RANGE = "BrandInfo!A:R"; // Includes Phone in C and Done in R

// Normalize phone numbers to last 10 digits
const normalizeNumber = (num) => (num ? String(num).replace(/\D/g, "").slice(-10) : "");

// Resolve Google SheetId for a given sheet title
async function getSheetIdByTitle(title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  const sh = (meta.data.sheets || []).find((s) => s.properties.title === title);
  if (!sh) throw new Error(`Sheet with title '${title}' not found`);
  return sh.properties.sheetId;
}

// POST /api/markFilled
// Body: { number: string, brand?: string }
router.post("/", async (req, res) => {
  const { number, brand } = req.body || {};
  if (!number) {
    return res.status(400).json({ message: "'number' is required in body" });
  }

  try {
    // Read all rows
    const readResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = readResp.data.values || [];
    const needle = normalizeNumber(number);
    const t = (v) => (v === undefined || v === null ? "" : String(v).trim());
    const normBrand = (v) => t(v).toLowerCase();
    const brandNeedle = brand ? normBrand(brand) : "";

    // Find the single best row to update
    // - If brand provided: first matching row where Done != Y
    // - Else: first row for that phone where Done != Y
    let targetRowNum = null; // 1-based
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const phone = row[2] || ""; // Column C
      if (normalizeNumber(phone) !== needle) continue;
      if (brandNeedle && normBrand(row[0]) !== brandNeedle) continue; // Column A brand

      const doneVal = t(row[17]).toUpperCase(); // Column R (0-based 17)
      if (doneVal !== "Y") {
        targetRowNum = i + 1;
        break;
      }
    }

    if (!targetRowNum) {
      return res.status(200).json({
        number: needle,
        brand: brand || undefined,
        updatedCount: 0,
        message: brandNeedle
          ? "No unmarked rows found for this number+brand."
          : "No unmarked rows found for this number.",
      });
    }

    // Prepare values update for Done column (R) to 'Y' for one row
    const data = [{
      range: `BrandInfo!R${targetRowNum}`,
      values: [["Y"]],
    }];

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    });

    // Color that cell green via batchUpdate (Done column R)
    const sheetId = await getSheetIdByTitle("BrandInfo");
    const rowIndex0 = targetRowNum - 1;
    const requests = [{
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex0, // 0-based, header is 0
          endRowIndex: rowIndex0 + 1,
          startColumnIndex: 17, // Column R (0-based)
          endColumnIndex: 18,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.86, green: 1.0, blue: 0.86 }, // light green
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    }];

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests },
      });
    }

    return res.status(200).json({
      number: needle,
      brand: brand || undefined,
      updatedCount: 1,
      updatedRows: [targetRowNum],
      message: "Done marked as 'Y' and cell colored green.",
    });
  } catch (error) {
    console.error("/api/markFilled error:", error);
    return res
      .status(500)
      .json({ message: "Error marking Filled status.", error: error.message });
  }
});

module.exports = router;
