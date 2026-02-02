const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

/**
 * Get Google Auth instance
 * Tries environment variable first, then falls back to service-account.json file
 */
function getGoogleAuth(scopes = ["https://www.googleapis.com/auth/spreadsheets"]) {
  // Try environment variable first (for production/Render)
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      console.log("✓ Using Google credentials from environment variable");
      return new google.auth.GoogleAuth({
        credentials,
        scopes,
      });
    } catch (error) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT env var:", error.message);
      throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT environment variable");
    }
  }

  // Fall back to file (for local development)
  const SERVICE_ACCOUNT_FILE = path.join(__dirname, "../service-account.json");
  
  if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    throw new Error(
      "No Google credentials found. Set GOOGLE_SERVICE_ACCOUNT env var or create service-account.json"
    );
  }

  console.log("✓ Using Google credentials from service-account.json file");
  return new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_FILE,
    scopes,
  });
}

/**
 * Get Google Sheets API instance
 */
function getGoogleSheets(scopes = ["https://www.googleapis.com/auth/spreadsheets"]) {
  const auth = getGoogleAuth(scopes);
  return google.sheets({ version: "v4", auth });
}

module.exports = { getGoogleAuth, getGoogleSheets };
