const express = require("express");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const { getGoogleSheets } = require("../lib/googleAuth");

const router = express.Router();
const sheets = getGoogleSheets();

const SPREADSHEET_ID = "1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ";
const CLIENT_DATA_RANGE = "BrandInfo!A:F";
const RESPONSE_SHEET = "Responses!A:J";
const RESPONSE_LOG_SHEET = "ResponseLog!A:Z";
const CSAT_SHEET = "CSAT!A:L"; // Updated to store data in the same row

// Function to get the last response ID
async function getNextResponseId() {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RESPONSE_SHEET,
    });

    const rows = result.data.values;

    // Ensure we start counting from row 2 (ignoring header row)
    return rows && rows.length > 1 ? rows.length : 2;
  } catch (error) {
    console.error("[ERROR] Fetching Response ID:", error.message);
    throw new Error("Failed to fetch the latest response ID");
  }
}

// Function to get client data from BrandInfo
async function getClientData(phoneNumber) {
  try {
    console.log(`[INFO] Fetching client data for Phone Number: ${phoneNumber}`);
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: CLIENT_DATA_RANGE,
    });

    const rows = result.data.values;
    if (!rows || rows.length === 0) {
      console.warn("[WARNING] No data found in BrandInfo sheet.");
      return null;
    }

    for (let row of rows) {
      if (row[0] === phoneNumber) {
        console.log(`[INFO] Found client data for ${phoneNumber}`);
        return {
          whatsappNo: row[0] || "",
          brandName: row[1] || "",
          vertical: row[2] || "",
          email: row[3] || "",
          clientId: row[4] || "",
          sbu: row[5] || "",
        };
      }
    }
    console.warn(
      `[WARNING] Client data not found for phone number: ${phoneNumber}`
    );
    return null;
  } catch (error) {
    console.error("[ERROR] Fetching client data:", error.message);
    throw new Error("Failed to fetch client data from BrandInfo");
  }
}

// Function to get the latest row index in Responses
async function getLatestResponseRowIndex() {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RESPONSE_SHEET,
    });

    const rows = result.data.values;

    // Ensure data starts from row 2, leaving header untouched
    return rows && rows.length > 1 ? rows.length + 1 : 2;
  } catch (error) {
    console.error("[ERROR] Fetching latest response row index:", error.message);
    throw new Error("Failed to retrieve latest response row index");
  }
}

// API Endpoint
router.post("/", async (req, res) => {
  try {
    console.log("[INFO] Received API request:", req.body);

    let { phoneNumber, firstName, lastName } = req.body;

    // Handle missing first name or last name by replacing with "NA"
    if (!firstName || firstName.trim() === "") {
      firstName = "NA";
    }
    if (!lastName || lastName.trim() === "") {
      lastName = "NA";
    }

    if (!phoneNumber) {
      console.warn("[WARNING] Missing phone number in request.");
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    const responseId = await getNextResponseId();
    const clientData = await getClientData(phoneNumber);

    if (!clientData) {
      console.warn(`[WARNING] No client data found for phone: ${phoneNumber}`);
      return res.status(404).json({
        success: false,
        message: "Client data not found for this phone number.",
      });
    }

    const {
      whatsappNo,
      brandName,
      vertical,
      email,
      clientId,
      sbu,
    } = clientData;
    const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    console.log(`[INFO] Writing Response ID first into Responses sheet`);

    // Get latest row index
    const rowIndex = await getLatestResponseRowIndex();

    // Step 1: Insert only Response ID in Responses sheet (column A)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Responses!A${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[responseId]] },
    });

    console.log(`[INFO] Updating full response data in the same row`);

    // Step 2: Update the same row with full data
    const responseValues = [
      [
        timestamp,
        responseId,
        whatsappNo,
        email,
        clientId,
        firstName,
        lastName,
        brandName,
        sbu,
        vertical,
      ],
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Responses!A${rowIndex}:J${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: responseValues },
    });

    console.log(`[INFO] Inserting Response ID into CSAT in the same row`);

    // Step 3: Insert Response ID into the same row in CSAT
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `CSAT!A${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[responseId]] },
    });

    console.log(`[INFO] Updating ResponseLog sheet`);

    // Step 4: Insert latest response data into ResponseLog
    const responseLogValues = [
      [
        timestamp,
        responseId,
        whatsappNo,
        email,
        clientId,
        firstName,
        lastName,
        brandName,
        sbu,
        vertical,
      ],
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `ResponseLog!A${rowIndex}:J${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: responseLogValues },
    });

    console.log(
      `[SUCCESS] Response recorded successfully with Response ID: ${responseId}`
    );
    return res.status(201).json({
      success: true,
      message: "Response recorded successfully!",
      responseId,
      timestamp,
      whatsappNo,
      email,
      clientId,
      firstName,
      lastName,
      brandName,
      sbu,
      vertical,
    });
  } catch (error) {
    console.error("[ERROR] Unexpected error in API:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error. Please try again later.",
      error: error.message,
    });
  }
});

module.exports = router;
