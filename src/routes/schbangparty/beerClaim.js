const express = require("express");
const moment = require("moment-timezone");
const { getGoogleSheets } = require("../../lib/googleAuth");

const router = express.Router();
const sheets = getGoogleSheets();

// ─── Google Sheet Config ──────────────────────────────────────────────────────
// TODO: Replace these with real spreadsheet IDs once provided
const USER_SPREADSHEET_ID = "1rHmh7_WMHeAlHsb-bVe6MDw7imVVGrT-tEbSpYWz3OQ";
const USER_SHEET_NAME = "Employee_data"; // Tab containing: Zoho ID | Name | Contact | Photo

const CLAIMS_SPREADSHEET_ID = "1rHmh7_WMHeAlHsb-bVe6MDw7imVVGrT-tEbSpYWz3OQ";
const CLAIMS_SHEET_NAME = "beer_counter"; // Tab for claims: Zoho ID | Name | Contact | Photo | Claim 1 | Claim 2 | Total

const MAX_CLAIMS = 2;

// ─── Column indices (0-based) for the Claims sheet ────────────────────────────
const COL = {
    ZOHO_ID: 0,    // A
    NAME: 1,       // B
    CONTACT: 2,    // C
    PHOTO: 3,      // D
    CLAIM_1: 4,    // E — timestamp of 1st claim
    CLAIM_2: 5,    // F — timestamp of 2nd claim
    TOTAL: 6,      // G — total claims count
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() {
    return moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
}

/**
 * Fetch all rows from a sheet and return as 2-D array (first row = headers)
 */
async function getAllRows(spreadsheetId, sheetName) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}`,
    });
    return res.data.values || [];
}

/**
 * Look up user in the User Directory sheet by Zoho ID (column A)
 * Returns { zohoId, name, contact, photo } or null
 */
async function findUserByZohoId(zohoId) {
    const rows = await getAllRows(USER_SPREADSHEET_ID, USER_SHEET_NAME);
    if (rows.length < 2) return null; // only header or empty

    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (String(row[0] || "").trim() === String(zohoId).trim()) {
            return {
                zohoId: (row[0] || "").trim(),
                name: (row[1] || "").trim(),
                contact: (row[2] || "").trim(),
                photo: (row[3] || "").trim(),
            };
        }
    }
    return null;
}

/**
 * Find existing claim row index (1-based, includes header) in Claims sheet
 * Returns { rowIndex, row } or null
 */
async function findClaimRow(zohoId) {
    const rows = await getAllRows(CLAIMS_SPREADSHEET_ID, CLAIMS_SHEET_NAME);
    if (rows.length < 2) return null;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (String(row[COL.ZOHO_ID] || "").trim() === String(zohoId).trim()) {
            return { rowIndex: i + 1, row }; // +1 because sheets are 1-indexed
        }
    }
    return null;
}

// ─── GET /user/:zohoId ───────────────────────────────────────────────────────
// Fetch user data from the User Directory sheet

router.get("/user/:zohoId", async (req, res) => {
    const { zohoId } = req.params;

    if (!zohoId || !zohoId.trim()) {
        return res.status(400).json({
            status: "error",
            message: "Zoho ID is required",
        });
    }

    try {
        const user = await findUserByZohoId(zohoId);

        if (!user) {
            return res.status(404).json({
                status: "error",
                message: "User not found with the provided Zoho ID",
            });
        }

        // Also check claims sheet to return current claim count
        const claim = await findClaimRow(zohoId);
        const totalClaims = claim ? parseInt(claim.row[COL.TOTAL] || "0", 10) : 0;

        return res.status(200).json({
            status: "success",
            data: {
                ...user,
                totalClaims,
                remainingClaims: Math.max(0, MAX_CLAIMS - totalClaims),
            },
        });
    } catch (error) {
        console.error("[schbangparty beer] GET /user error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to fetch user data",
            error: error.message,
        });
    }
});

// ─── POST /claim ─────────────────────────────────────────────────────────────
// Record a beer claim. Body: { zohoId, claimNumber }
// claimNumber = 1 or 2

router.post("/claim", async (req, res) => {
    const { zohoId, claimNumber } = req.body || {};

    // ── Validate input ──
    if (!zohoId || !String(zohoId).trim()) {
        return res.status(400).json({
            status: "error",
            message: "zohoId is required",
        });
    }

    const claimNum = parseInt(claimNumber, 10);
    if (!claimNum || claimNum < 1 || claimNum > MAX_CLAIMS) {
        return res.status(400).json({
            status: "error",
            message: `claimNumber must be between 1 and ${MAX_CLAIMS}`,
        });
    }

    try {
        const timestamp = now();
        const existingClaim = await findClaimRow(zohoId);

        if (existingClaim) {
            // ── User already has a row in Claims sheet ──
            const { rowIndex, row } = existingClaim;
            const currentTotal = parseInt(row[COL.TOTAL] || "0", 10);

            if (currentTotal >= MAX_CLAIMS) {
                return res.status(400).json({
                    status: "error",
                    message: `Maximum of ${MAX_CLAIMS} claims already reached for this user`,
                    totalClaims: currentTotal,
                });
            }

            // Determine which claim slot to fill (next available)
            const nextClaimCol = currentTotal === 0 ? COL.CLAIM_1 : COL.CLAIM_2;
            const newTotal = currentTotal + 1;

            // Update the claim timestamp and total
            const claimColLetter = nextClaimCol === COL.CLAIM_1 ? "E" : "F";
            const updateRange = `${CLAIMS_SHEET_NAME}!${claimColLetter}${rowIndex}:G${rowIndex}`;

            const updateValues =
                nextClaimCol === COL.CLAIM_1
                    ? [[timestamp, "", String(newTotal)]]
                    : [["", timestamp, String(newTotal)]]; // keep claim_1 cell untouched via batch

            // Use batchUpdate to update specific cells
            await sheets.spreadsheets.values.update({
                spreadsheetId: CLAIMS_SPREADSHEET_ID,
                range: `${CLAIMS_SHEET_NAME}!${claimColLetter}${rowIndex}`,
                valueInputOption: "RAW",
                resource: { values: [[timestamp]] },
            });

            // Update total
            await sheets.spreadsheets.values.update({
                spreadsheetId: CLAIMS_SPREADSHEET_ID,
                range: `${CLAIMS_SHEET_NAME}!G${rowIndex}`,
                valueInputOption: "RAW",
                resource: { values: [[String(newTotal)]] },
            });

            return res.status(200).json({
                status: "success",
                message: `Claim ${newTotal} of ${MAX_CLAIMS} recorded`,
                totalClaims: newTotal,
                remainingClaims: MAX_CLAIMS - newTotal,
            });
        } else {
            // ── User doesn't exist in Claims sheet — create new row ──

            // First, verify the user exists in the User Directory
            const user = await findUserByZohoId(zohoId);
            if (!user) {
                return res.status(404).json({
                    status: "error",
                    message: "User not found with the provided Zoho ID",
                });
            }

            // Create a new row: Zoho ID | Name | Contact | Photo | Claim1 | Claim2 | Total
            const newRow = [
                user.zohoId,
                user.name,
                user.contact,
                user.photo,
                timestamp, // first claim
                "",        // second claim empty
                "1",       // total = 1
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId: CLAIMS_SPREADSHEET_ID,
                range: `${CLAIMS_SHEET_NAME}!A1:G1`,
                valueInputOption: "RAW",
                insertDataOption: "INSERT_ROWS",
                resource: { values: [newRow] },
            });

            return res.status(201).json({
                status: "success",
                message: `Claim 1 of ${MAX_CLAIMS} recorded`,
                totalClaims: 1,
                remainingClaims: MAX_CLAIMS - 1,
            });
        }
    } catch (error) {
        console.error("[schbangparty beer] POST /claim error:", error);
        return res.status(500).json({
            status: "error",
            message: "Failed to record claim",
            error: error.message,
        });
    }
});

module.exports = router;
