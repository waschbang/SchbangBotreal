const express = require("express");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const path = require("path");

const router = express.Router();

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: scopes,
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ"; // Replace with your actual spreadsheet ID
const RANGE = "Feedback!A:C"; // Adjust the range to include all fields

// POST route to handle incoming user details
router.post("/", async (req, res) => {
  const { name, details, email } = req.body;

  // Get the current timestamp in Mumbai timezone
  const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  try {
    // Save to Google Sheets
    const values = [[timestamp, name, details, email]]; // Include all fields in the values
    const resource = { values };
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: "RAW",
      resource,
    });

    res.status(201).send("User details saved successfully in Google Sheets!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error saving user details.");
  }
});

module.exports = router;
