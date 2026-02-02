const express = require("express");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const router = express.Router();
// const clientPromise = require("../lib/mongodb.js"); // Change to require
const path = require("path");

// ... rest of your code ...

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: scopes,
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY";
const RANGE = "Sheet1!A:F";

router.post("/", async (req, res) => {
  const {
    name,
    brandName,
    email,
    website,
    services,
    businessChallenge,
  } = req.body;

  const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  try {
    const values = [
      [timestamp, name, brandName, email, website, services, businessChallenge],
    ];
    const resource = { values };
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: "RAW",
      resource,
    });

    res.status(201).send("Data saved successfully in Google Sheets!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error saving data.");
  }
});

module.exports = router;
