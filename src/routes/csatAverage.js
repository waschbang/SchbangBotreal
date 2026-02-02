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

// Sheets and column mappings based on the actual sheet structure
const SHEET_CONFIGS = {
  tech: {
    range: "TECH!A:N", // All columns with ratings
    phoneColumn: "A", // Whatsapp Number column
    // Columns to include in average calculation (based on Image 1)
    ratingColumns: ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"],
    resultColumn: "D", // In the Main sheet - Tech column
    dateColumn: "N", // Column M has CreatedAt timestamp (from Image 1)
  },
  solution: {
    range: "SOLUTIONS!A:K",
    phoneColumn: "A", // Whatsapp Number column
    // Columns to include in average calculation (based on Image 2)
    ratingColumns: ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
    resultColumn: "F", // In the Main sheet - Solutions column
    dateColumn: "L", // Column K has CreatedAt timestamp (from Image 2)
  },
  media: {
    range: "MEDIA!A:N",
    phoneColumn: "A", // Whatsapp Number column
    // Columns to include in average calculation (based on Image 3)
    ratingColumns: ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
    resultColumn: "E", // In the Main sheet - Media column
    dateColumn: "M", // Column M has CreatedAt timestamp (from Image 3)
  },
};

// Helper function to convert column letter to index
const columnToIndex = (column) => {
  return column.charCodeAt(0) - 65; // 'A' is 65 in ASCII, so 'A' -> 0, 'B' -> 1, etc.
};

// Add month mapping helper after the columnToIndex function
// Helper function to get column letter for current month
function getCurrentMonthColumn() {
  // Month columns start from J (January) to U (December)
  const monthColumns = [
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
  ];
  const currentMonth = new Date().getMonth(); // 0-based (0 = January)
  return monthColumns[currentMonth];
}

// Helper function to get brand information
async function getBrandInfo(phoneNumber) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "BrandInfo!A:I",
    });

    const rows = response.data.values || [];

    // Default values if not found
    let brandInfo = {
      name: "",
      brandName: "",
      vertical: "",
      email: "",
      solution: "N",
      tech: "N",
      media: "N",
    };

    // Find the matching phone number
    for (const row of rows) {
      if (row[0] === phoneNumber) {
        brandInfo = {
          name: row[1] || "",
          brandName: row[1] || "",
          vertical: row[2] || "",
          email: row[3] || "",
          solution: row[6] === "Y" ? "Y" : "N",
          tech: row[7] === "Y" ? "Y" : "N",
          media: row[8] === "Y" ? "Y" : "N",
        };
        break;
      }
    }

    return brandInfo;
  } catch (error) {
    console.error("Error getting brand info:", error);
    return {
      name: "",
      brandName: "",
      vertical: "",
      email: "",
      solution: "N",
      tech: "N",
      media: "N",
    };
  }
}

// Function to calculate average from values
function calculateAverage(values) {
  if (values.length === 0) return "NA";
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(2);
}

// POST route to calculate CSAT averages
router.post("/", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    // Step 1: Get brand information
    const brandInfo = await getBrandInfo(phoneNumber);

    // Object to store results from each sheet
    const results = {
      tech: { found: false, values: [], avg: "NA" },
      solution: { found: false, values: [], avg: "NA" },
      media: { found: false, values: [], avg: "NA" },
    };

    // Variable to track creation date
    let creationDate = "";
    let firstSheetWithDate = "";

    // Step 2: Fetch CSAT data and calculate averages (only for services the client has)
    const sheetsToCheck = [];
    if (brandInfo.tech === "Y") sheetsToCheck.push("tech");
    if (brandInfo.solution === "Y") sheetsToCheck.push("solution");
    if (brandInfo.media === "Y") sheetsToCheck.push("media");

    // If no services found, check all sheets anyway
    if (sheetsToCheck.length === 0) {
      sheetsToCheck.push("tech", "solution", "media");
    }

    // Fetch all sheet data in parallel for better performance
    await Promise.all(
      sheetsToCheck.map(async (sheetName) => {
        const config = SHEET_CONFIGS[sheetName];
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: config.range,
        });

        const rows = response.data.values || [];
        if (rows.length === 0) {
          console.warn(`Warning: No data found in ${sheetName} sheet`);
          return;
        }

        const phoneColIndex = columnToIndex(config.phoneColumn);
        const dateColIndex = columnToIndex(config.dateColumn);

        // Find all rows with the matching phone number
        for (let i = 1; i < rows.length; i++) {
          // Start from 1 to skip header
          const row = rows[i];
          if (row && row[phoneColIndex] === phoneNumber) {
            results[sheetName].found = true;

            // Capture creation date if it exists and we don't have one yet
            if (!creationDate && row[dateColIndex]) {
              creationDate = row[dateColIndex];
              firstSheetWithDate = sheetName;
              console.log(
                `Found creation date ${creationDate} in ${sheetName} sheet`
              );
            }

            // Extract ratings from this row based on configured rating columns
            for (const colLetter of config.ratingColumns) {
              const colIndex = columnToIndex(colLetter);
              if (
                row[colIndex] &&
                !isNaN(row[colIndex]) &&
                row[colIndex] !== ""
              ) {
                results[sheetName].values.push(parseFloat(row[colIndex]));
              }
            }
          }
        }

        // Calculate average
        results[sheetName].avg = calculateAverage(results[sheetName].values);
      })
    );

    // Step 3: Check if phone number exists in Main sheet
    const mainSheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "MAIN!A:A",
    });

    const mainRows = mainSheetResponse.data.values || [];
    // let rowIndex = -1;

    // Find if phone number already exists
    // for (let i = 0; i < mainRows.length; i++) {
    //   if (mainRows[i][0] === phoneNumber) {
    //     rowIndex = i + 1; // +1 because sheet rows are 1-indexed
    //     break;
    //   }
    // }

    // Step 4: Always append new row with phone number, brand info, and averages
    const newRow = [phoneNumber]; // Start with phone number in column A
    // Column B - Name
    newRow[1] = brandInfo.name || "";
    // Column C - Brand
    newRow[2] = brandInfo.brandName || "";
    // Column D - Tech Average
    newRow[3] = results.tech.avg;
    // Column E - Media Average
    newRow[4] = results.media.avg;
    // Column F - Solutions Average
    newRow[5] = results.solution.avg;
    // Column G - Creation Date
    newRow[6] = creationDate || "";

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "MAIN!A:G",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [newRow],
      },
    });

    // NEW STEP: Update the current month column with "Y" in BrandInfo sheet
    try {
      // First, find the row index for this phone number in BrandInfo
      const brandInfoResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "BrandInfo!A:A",
      });

      const brandInfoRows = brandInfoResponse.data.values || [];
      let brandInfoRowIndex = -1;

      for (let i = 0; i < brandInfoRows.length; i++) {
        if (brandInfoRows[i][0] === phoneNumber) {
          brandInfoRowIndex = i + 1; // +1 because sheet rows are 1-indexed
          break;
        }
      }

      if (brandInfoRowIndex > 0) {
        // Get the current month column (J to U)
        const monthColumn = getCurrentMonthColumn();

        console.log(
          `Updating CSAT status for ${phoneNumber} - Current month column: ${monthColumn}`
        );

        // Update the current month column with "Y"
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `BrandInfo!${monthColumn}${brandInfoRowIndex}`,
          valueInputOption: "USER_ENTERED",
          resource: {
            values: [["Y"]],
          },
        });

        console.log(
          `Successfully updated CSAT status for ${phoneNumber} in column ${monthColumn}`
        );
      } else {
        console.log(
          `Phone number ${phoneNumber} not found in BrandInfo sheet, cannot update month status`
        );
      }
    } catch (monthUpdateError) {
      console.error("Error updating month status:", monthUpdateError);
      // Continue with response - this shouldn't fail the entire request
    }

    // Return the results
    res.status(200).json({
      phoneNumber,
      brandInfo: {
        name: brandInfo.name,
        brandName: brandInfo.brandName,
        vertical: brandInfo.vertical,
        services: {
          tech: brandInfo.tech,
          solution: brandInfo.solution,
          media: brandInfo.media,
        },
      },
      creationDate: creationDate || "",
      firstSheetWithDate: firstSheetWithDate,
      averages: {
        tech: results.tech.avg,
        solution: results.solution.avg,
        media: results.media.avg,
      },
      monthUpdateStatus: "attempted", // Indicate that we tried to update the month
    });
  } catch (error) {
    console.error("Error calculating CSAT averages:", error);
    res.status(500).json({ error: "Error calculating CSAT averages" });
  }
});

module.exports = router;
