const express = require("express");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const { getGoogleSheets } = require("../lib/googleAuth");

const router = express.Router();

const sheets = getGoogleSheets();
const SPREADSHEET_ID = "1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ"; // Replace with your actual spreadsheet ID
const RANGE = "Sheet2!A:E"; // Adjust the range to include all fields

// POST route to handle incoming training data
router.post("/", async (req, res) => {
  const {
    name,
    email,
    topicOfInterest,
    employeeCount,
    employeeDetail,
  } = req.body;

  // Get the current timestamp in Mumbai timezone
  const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  try {
    // Save to Google Sheets
    const values = [
      [
        timestamp,
        name,
        email,
        topicOfInterest,
        String(employeeCount),
        employeeDetail,
      ],
    ];
    const resource = { values };
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: "RAW",
      resource,
    });

    res.status(201).send("Training data saved successfully in Google Sheets!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error saving training data.");
  }
});

module.exports = router;
