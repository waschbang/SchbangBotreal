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
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY";

// GET route to retrieve all data from the MAIN sheet
router.get("/", async (req, res) => {
  try {
    // Fetch data from Main sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "MAIN!A:G", // Get all columns from A to G
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
      return res.status(200).json({
        message: "No data found in Main sheet",
        data: [],
      });
    }

    // Get header row for property names
    const headers = rows[0];

    // Convert data to array of obj
    const data = rows.slice(1).map((row) => {
      const item = {};

      // Map each column to its corresponding header
      headers.forEach((header, index) => {
        // Make sure we don't go out of bounds if a row has fewer columns
        if (index < row.length) {
          // Convert values to appropriate types
          if (
            header === "Tech" ||
            header === "Media" ||
            header === "Solutions"
          ) {
            // Convert averages to numbers where possible
            item[header] = row[index] === "NA" ? "NA" : parseFloat(row[index]);
          } else {
            item[header] = row[index];
          }
        } else {
          item[header] = "";
        }
      });

      return item;
    });

    res.status(200).json({
      message: "Main sheet data retrieved successfully",
      totalRecords: data.length,
      data: data,
    });
  } catch (error) {
    console.error("Error retrieving Main sheet data:", error);
    res.status(500).json({ error: "Error retrieving Main sheet data" });
  }
});

module.exports = router;
