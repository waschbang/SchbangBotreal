const express = require("express");
const { google } = require("googleapis");
const path = require("path");

const router = express.Router();

const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: scopes,
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY"; // Replace with your actual spreadsheet ID
const RANGE = "MainData!A:B"; // Adjust the range to include Client and Schbanger columns

// POST route to check the ID
router.post("/", async (req, res) => {
  const { number, name } = req.body; // Expecting both number and name in the request body

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    let result = "U"; // Default to 'U' (unknown)

    if (rows) {
      for (const row of rows) {
        if (row[0] === String(number)) {
          result = "C"; // Client
          break;
        } else if (row[1] === String(number)) {
          result = "S"; // Schbanger
          break;
        }
      }
    }

    // Send the result in an object
    res.status(200).send({ result: result });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error checking ID.");
  }
});

module.exports = router;
