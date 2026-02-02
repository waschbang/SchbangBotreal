const express = require("express");
const router = express.Router();
const { google } = require("googleapis");
const path = require("path");

// Sheet/tab name for this endpoint
const SHEET_NAME = "SendAny";
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY"; // Use your main spreadsheet

// Helper to get Google Sheets instance
async function getSheets() {
  try {
    const serviceAccountPath = path.join(__dirname, "../service-account.json");
    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    return google.sheets({ version: "v4", auth: client });
  } catch (error) {
    console.error("Error initializing Google Sheets API:", error);
    throw new Error(`Failed to initialize Google Sheets: ${error.message}`);
  }
}

/**
 * Extracts JSON data from text that may be wrapped in code blocks
 * @param {string|object} input - The input data that might contain JSON in code blocks
 * @returns {object} - Parsed JSON object
 * @throws {Error} - If JSON extraction or parsing fails
 */
function extractJsonData(input) {
  if (
    typeof input !== "string" &&
    input !== null &&
    typeof input === "object"
  ) {
    return input;
  }

  // If input is not a string, throw error
  if (typeof input !== "string") {
    throw new Error("Input is not a string or object");
  }

  // Log the raw input for debugging (limited to 200 chars)
  console.log(
    "Raw input sample:",
    input.substring(0, 200).replace(/\n/g, "\\n")
  );

  // Handle the specific format: "2. Content 0 Text : ```json {...} ```"
  const contentTextPrefix = /(?:(?:\d+\.)?\s*Content\s+0\s+Text\s*:\s*)?```json\s*([\s\S]*?)\s*```/;
  const contentTextMatch = input.match(contentTextPrefix);

  if (contentTextMatch && contentTextMatch[1]) {
    try {
      console.log("Matched Content 0 Text format");
      return JSON.parse(contentTextMatch[1]);
    } catch (error) {
      console.error("Failed to parse Content 0 Text JSON:", error);
    }
  }

  // Handle dynamic_value span format
  if (input.includes('class="dynamic_value"') && input.includes("```json")) {
    try {
      const dynamicValueMatch = input.match(/```json\s*([\s\S]*?)\s*```/);
      if (dynamicValueMatch && dynamicValueMatch[1]) {
        console.log("Extracted JSON from dynamic_value span");
        return JSON.parse(dynamicValueMatch[1]);
      }
    } catch (error) {
      console.error("Failed to parse dynamic_value JSON:", error);
    }
  }

  // Special case for the format: ```json\n{...}\n```
  const specialFormatRegex = /```json\\n([\s\S]*?)\\n```/;
  const specialMatch = input.match(specialFormatRegex);

  if (specialMatch && specialMatch[1]) {
    try {
      console.log("Matched special format with \\n characters");
      return JSON.parse(specialMatch[1]);
    } catch (error) {
      console.error("Failed to parse special format JSON:", error);
    }
  }

  // Check for the exact format from example
  if (input.startsWith("```json\\n") && input.endsWith("\\n```")) {
    try {
      const jsonContent = input.substring(
        "```json\\n".length,
        input.length - "\\n```".length
      );
      console.log("Extracted using exact format match");
      return JSON.parse(jsonContent);
    } catch (error) {
      console.error("Failed to parse with exact format match:", error);
    }
  }

  // Check for JSON code block format with various delimiters
  // This handles ```json\n{...}\n``` format and other variations
  const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
  const match = input.match(jsonBlockRegex);

  if (match && match[1]) {
    try {
      console.log("Matched standard code block format");
      return JSON.parse(match[1]);
    } catch (error) {
      console.error(
        "Failed to parse JSON from code block:",
        error,
        "Content:",
        match[1]
      );
    }
  }

  // Try to handle escaped newlines by replacing them
  if (input.includes("\\n")) {
    try {
      // Try to extract just the JSON part
      let cleanedInput = input.replace(/```json\\n|\\n```/g, "");
      console.log("Trying to parse with cleaned input (removed \\n markers)");
      return JSON.parse(cleanedInput);
    } catch (error) {
      console.error("Failed to parse cleaned input:", error);

      try {
        // Try alternate approach - replace literal \n with nothing
        const noBackslashes = input
          .replace(/\\n/g, "")
          .replace(/```json|```/g, "");
        console.log("Trying with all \\n removed");
        return JSON.parse(noBackslashes);
      } catch (innerError) {
        console.error("Failed second cleaning attempt:", innerError);
      }
    }
  }

  // Last resort: Extract any JSON object from the string
  try {
    const jsonPattern = /{[\s\S]*?}/;
    const jsonMatch = input.match(jsonPattern);
    if (jsonMatch && jsonMatch[0]) {
      console.log("Extracted JSON object using pattern matching");
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Failed to extract JSON using pattern matching:", error);
  }

  // Very last resort: If no code block format, try parsing the entire input as JSON
  try {
    return JSON.parse(input);
  } catch (error) {
    console.error(
      "Failed to parse raw JSON:",
      error,
      "Input (first 100 chars):",
      input.substring(0, 100)
    );

    throw new Error(`Failed to parse JSON: ${error.message}`);
  }
}

/**
 * Direct handler for the problematic ```json\n{...}\n``` format
 * This is a custom solution for this specific issue
 * @param {string} input - The raw input string with escaped newlines
 * @returns {object|null} - Parsed JSON object or null if parsing fails
 */

function parseEscapedJsonFormat(input) {
  console.log("🔧 Attempting to parse problematic escaped format");

  // Check if this is the format we're looking for
  if (!input || typeof input !== "string" || !input.includes("```json\\n")) {
    return null;
  }

  try {
    // Step 1: Extract just the JSON content
    let match = input.match(/```json\\n(.*?)\\n```/s);
    if (!match || !match[1]) {
      console.log("🔧 No match found with regex");
      return null;
    }

    const jsonContent = match[1];
    console.log(
      "🔧 Extracted content (first 50 chars):",
      jsonContent.substring(0, 50)
    );

    // Step 2: Try direct JSON parse
    try {
      const parsed = JSON.parse(jsonContent);
      console.log("🔧 Direct parsing successful!");
      return parsed;
    } catch (e) {
      console.log("🔧 Direct parsing failed:", e.message);
    }

    // Step 3: Remove escape characters and try again
    try {
      const unescaped = jsonContent.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const parsed = JSON.parse(unescaped);
      console.log("🔧 Parsing after unescaping successful!");
      return parsed;
    } catch (e) {
      console.log("🔧 Unescaped parsing failed:", e.message);
    }

    // Step 4: Manual approach - string splitting
    // This format: {"key": "value", "key2": "value2"}
    const result = {};

    // First check if it looks like a JSON object
    if (!jsonContent.startsWith("{") || !jsonContent.endsWith("}")) {
      console.log("🔧 Content doesn't look like a JSON object");
      return null;
    }

    // Remove outer braces
    const content = jsonContent.substring(1, jsonContent.length - 1);

    // Split by commas not inside quotes
    let inQuote = false;
    let currentKey = "";
    let pairs = [];
    let currentPair = "";

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      // Handle quotes (considering escaped quotes)
      if (char === '"' && (i === 0 || content[i - 1] !== "\\")) {
        inQuote = !inQuote;
      }

      // If comma outside quotes, we have a complete pair
      if (char === "," && !inQuote) {
        pairs.push(currentPair.trim());
        currentPair = "";
      } else {
        currentPair += char;
      }
    }

    // Add the last pair
    if (currentPair.trim()) {
      pairs.push(currentPair.trim());
    }

    console.log("🔧 Found pairs:", pairs.length);

    // Process each pair
    pairs.forEach((pair) => {
      // Split by first colon not in quotes
      inQuote = false;
      let colonPos = -1;

      for (let i = 0; i < pair.length; i++) {
        const char = pair[i];
        if (char === '"' && (i === 0 || pair[i - 1] !== "\\")) {
          inQuote = !inQuote;
        }

        if (char === ":" && !inQuote && colonPos === -1) {
          colonPos = i;
          break;
        }
      }

      if (colonPos > 0) {
        let key = pair.substring(0, colonPos).trim();
        let value = pair.substring(colonPos + 1).trim();

        // Clean up key - remove quotes
        key = key.replace(/^"|"$/g, "");

        // Clean up value
        if (value.startsWith('"') && value.endsWith('"')) {
          // String value
          value = value.substring(1, value.length - 1);
        } else if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else if (!isNaN(value)) {
          value = Number(value);
        }

        result[key] = value;
      }
    });

    if (Object.keys(result).length > 0) {
      console.log(
        "🔧 Manual parsing successful! Found keys:",
        Object.keys(result)
      );
      return result;
    }

    return null;
  } catch (error) {
    console.error("🔧 Failed to parse format:", error);
    return null;
  }
}

// POST /sendany - store any posted data in the SendAny sheet
router.post("/", async (req, res) => {
  try {
    const rawData = req.body;
    let extractedText = null;

    console.log("========== SENDANY WEBHOOK DEBUG START ==========");
    console.log("🔍 INCOMING REQUEST DETAILS:");
    console.log("- Request method:", req.method);
    console.log("- Request URL:", req.url);
    console.log("- Request headers:", JSON.stringify(req.headers, null, 2));
    console.log("- Raw body type:", typeof req.body);
    console.log(
      "- Raw body keys:",
      req.body ? Object.keys(req.body) : "No keys"
    );
    console.log("- Raw body stringified:", JSON.stringify(req.body, null, 2));
    console.log("- Raw body length:", JSON.stringify(req.body).length);

    // Log first 500 characters of the raw body
    const bodyString = JSON.stringify(req.body);
    console.log("- Raw body first 500 chars:", bodyString.substring(0, 500));
    if (bodyString.length > 500) {
      console.log(
        "- Raw body last 200 chars:",
        bodyString.substring(bodyString.length - 200)
      );
    }

    console.log("========== START DEBUG ==========");
    console.log("Raw data type:", typeof rawData);

    // Declare jsonData at the top
    let jsonData = null;

    // NEW: Check if rawData is already a valid JSON object with meaningful data
    if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
      const keys = Object.keys(rawData);
      console.log("Input is object with keys:", keys);

      // Check if this looks like direct form data (has meaningful keys, not just Text/Content)
      const hasDirectData = keys.some(
        (key) =>
          !["Text", "Content", "2. Content 0 Text"].includes(key) &&
          key.length > 1 &&
          rawData[key] !== null &&
          rawData[key] !== undefined
      );

      if (hasDirectData && keys.length > 0) {
        console.log(
          "✅ DIRECT JSON OBJECT DETECTED - Using rawData directly as jsonData"
        );
        jsonData = rawData;
        console.log("Direct object has keys:", Object.keys(jsonData));
        console.log(
          "Sample values:",
          Object.entries(jsonData)
            .slice(0, 3)
            .map(
              ([k, v]) =>
                `${k}: ${typeof v === "string" ? v.substring(0, 50) : v}`
            )
        );

        // Skip all the extraction logic since we already have valid JSON
        // Jump directly to storing the data
      }
    }

    // Only proceed with extraction if we don't already have jsonData
    if (!jsonData) {
      // Special case: If the incoming data has a "Text" property directly containing JSON code block
      if (
        rawData &&
        rawData.Text &&
        typeof rawData.Text === "string" &&
        (rawData.Text.includes("```json") ||
          rawData.Text.includes('{"Brand Name"'))
      ) {
        console.log("Found direct Text property with JSON content");
        extractedText = rawData.Text;
      }
      // First, try to extract the JSON text regardless of format
      else if (typeof rawData === "string") {
        // If the input is directly a string, use it
        console.log(
          "Input is string, first 100 chars:",
          rawData.substring(0, 100)
        );
        extractedText = rawData;
      } else if (rawData && typeof rawData === "object") {
        console.log("Input is object with keys:", Object.keys(rawData));

        // Check if it's the pattern with Content 0 Text
        if (
          rawData.Content &&
          rawData.Content["0"] &&
          rawData.Content["0"].Text
        ) {
          console.log("Found Content[0].Text format");
          extractedText = rawData.Content["0"].Text;
        }
        // Check array format
        else if (
          rawData.Content &&
          Array.isArray(rawData.Content) &&
          rawData.Content[0] &&
          rawData.Content[0].Text
        ) {
          console.log("Found Content array format");
          extractedText = rawData.Content[0].Text;
        }
        // Check direct Content.Text property
        else if (rawData.Content && rawData.Content.Text) {
          console.log("Found Content.Text format");
          extractedText = rawData.Content.Text;
        }
        // Check for directly having "2. Content 0 Text" as a key
        else if (rawData["2. Content 0 Text"]) {
          console.log("Found direct '2. Content 0 Text' key");
          extractedText = rawData["2. Content 0 Text"];
        }
      }
    }

    // If no data was found, return error
    if (!rawData) {
      return res.status(400).json({
        success: false,
        error: "Missing data in request body",
      });
    }

    if (extractedText) {
      console.log(
        "Extracted text found, first 100 chars:",
        extractedText.substring(0, 100)
      );
    } else {
      console.log("No text could be extracted from input");
    }

    // Try various parsing strategies
    if (extractedText && !jsonData) {
      // First try our custom parser for the problematic format
      jsonData = parseEscapedJsonFormat(extractedText);

      // If the custom parser didn't work, try the other methods
      if (!jsonData) {
        // Special direct handling for the known problematic format: ```json\n{...}\n```
        if (extractedText.includes("```json\\n")) {
          console.log("SPECIAL HANDLING: Detected ```json\\n format");
          try {
            // Handle the exact problem format
            const exactFormatMatch = /```json\\n(.*?)\\n```/s.exec(
              extractedText
            );
            if (exactFormatMatch && exactFormatMatch[1]) {
              const jsonString = exactFormatMatch[1];
              console.log(
                "Special format extraction successful, json string:",
                jsonString.substring(0, 100) + "..."
              );

              // Directly try to parse it without the escapes
              try {
                jsonData = JSON.parse(jsonString);
                console.log(
                  "Successfully parsed problematic format without cleaning"
                );
              } catch (jsonError) {
                console.log("Direct parse failed:", jsonError.message);

                // This is a completely custom solution for the exact format provided in the example
                console.log(
                  "ATTEMPTING MANUAL STRING EXTRACTION for the specific format"
                );
                try {
                  // Remove the code block markers and extract just the JSON content
                  // First, get rid of the ```json\n prefix and \n``` suffix
                  let directString = extractedText.replace(
                    /```json\\n|\\n```/g,
                    ""
                  );
                  console.log(
                    "After removing markers:",
                    directString.substring(0, 50)
                  );

                  // Now handle the JSON directly as a string
                  if (
                    directString.startsWith("{") &&
                    directString.endsWith("}")
                  ) {
                    // Try to manually parse the JSON object
                    const manualObj = parseJsonManually(directString);
                    if (manualObj && Object.keys(manualObj).length > 0) {
                      jsonData = manualObj;
                      console.log(
                        "MANUAL EXTRACTION SUCCESS! Found keys:",
                        Object.keys(jsonData)
                      );
                    }
                  }
                } catch (manualError) {
                  console.error("Manual extraction failed:", manualError);
                }

                // Try manual JSON extraction - regex approach
                if (
                  !jsonData &&
                  jsonString.startsWith("{") &&
                  jsonString.includes("}")
                ) {
                  console.log("Attempting regex-based JSON object extraction");
                  // Find all key-value pairs using regex
                  const keyValuePairs = {};
                  const matches = jsonString.match(/"([^"]+)":\s*"([^"]*)"/g);

                  if (matches) {
                    console.log(
                      `Found ${matches.length} key-value pairs using regex`
                    );
                    matches.forEach((match) => {
                      // Extract key and value
                      const keyMatch = /"([^"]+)":\s*/.exec(match);
                      const valueMatch = /:\s*"([^"]*)"/.exec(match);

                      if (
                        keyMatch &&
                        keyMatch[1] &&
                        valueMatch &&
                        valueMatch[1]
                      ) {
                        const key = keyMatch[1];
                        const value = valueMatch[1];
                        keyValuePairs[key] = value;
                      }
                    });

                    jsonData = keyValuePairs;
                    console.log(
                      "Regex extraction successful, found keys:",
                      Object.keys(jsonData)
                    );
                  }
                }
              }
            }
          } catch (error) {
            console.error("Special format handling failed:", error);
          }
        }

        // Try general extraction methods if special handling didn't work
        if (!jsonData) {
          try {
            console.log("Trying general extraction methods");
            jsonData = extractJsonData(extractedText);
            console.log("General extraction successful");
          } catch (error) {
            console.error("General extraction failed:", error.message);
          }
        }
      }
    }

    // Last resort: If we still don't have JSON data, try some extreme measures
    if (!jsonData) {
      // Look for any JSON-like structure in the raw data
      if (typeof rawData === "object" && !Array.isArray(rawData)) {
        // If the raw data has a Text field with a JSON string, parse it
        if (rawData.Text && typeof rawData.Text === "string") {
          console.log(
            "LAST RESORT: Attempting to extract JSON from Text field directly"
          );
          try {
            // Try to find a JSON object in the Text field
            const jsonMatch = rawData.Text.match(/{[\s\S]*?}/);
            if (jsonMatch && jsonMatch[0]) {
              try {
                const extractedJson = JSON.parse(jsonMatch[0]);
                if (extractedJson && typeof extractedJson === "object") {
                  jsonData = extractedJson;
                  console.log(
                    "Successfully extracted JSON from Text field, keys:",
                    Object.keys(jsonData)
                  );
                }
              } catch (innerError) {
                console.error(
                  "Failed to parse JSON from Text field:",
                  innerError.message
                );

                // Try to manually extract key-value pairs using regex
                const text = rawData.Text;
                if (text.includes("Brand Name") && text.includes("Industry")) {
                  console.log(
                    "Attempting direct string extraction for known format"
                  );
                  jsonData = extractJsonFromText(text);
                }
              }
            }
          } catch (error) {
            console.error("Failed to extract from Text field:", error.message);
          }
        }
      }
    }

    // If we *still* don't have valid JSON data, create a structured object from the Text field
    if (
      !jsonData &&
      rawData.Text &&
      rawData.Text.includes("```json\\n") &&
      rawData.Text.includes("Brand Name")
    ) {
      console.log("EMERGENCY EXTRACTION: Using hard-coded pattern matching");
      // Hard-coded extraction for the specific pattern seen in the logs
      const text = rawData.Text;
      jsonData = extractJsonFromText(text);
    }

    // Verify we have valid JSON data
    if (!jsonData || typeof jsonData !== "object") {
      console.error("❌ FAILED: Could not extract valid JSON data");
      console.error("🔍 FAILURE ANALYSIS:");
      console.error("- jsonData value:", jsonData);
      console.error("- jsonData type:", typeof jsonData);
      console.error(
        "- extractedText was:",
        extractedText ? extractedText.substring(0, 200) + "..." : "null"
      );
      console.error("- rawData keys:", rawData ? Object.keys(rawData) : "null");
      console.error("- rawData.Text exists:", !!(rawData && rawData.Text));
      console.error(
        "- rawData.Content exists:",
        !!(rawData && rawData.Content)
      );

      if (rawData && rawData.Text) {
        console.error("- rawData.Text type:", typeof rawData.Text);
        console.error(
          "- rawData.Text includes ```json:",
          rawData.Text.includes("```json")
        );
        console.error(
          "- rawData.Text includes Brand Name:",
          rawData.Text.includes("Brand Name")
        );
        console.error(
          "- rawData.Text first 300 chars:",
          rawData.Text.substring(0, 300)
        );
      }

      console.error(
        "========== SENDANY WEBHOOK DEBUG END (FAILURE) =========="
      );
      return res.status(400).json({
        success: false,
        error: "Failed to extract valid JSON data from the input",
        debug: {
          rawDataType: typeof rawData,
          rawDataKeys: rawData ? Object.keys(rawData) : null,
          extractedTextExists: !!extractedText,
          jsonDataType: typeof jsonData,
          jsonDataValue: jsonData,
        },
      });
    }

    console.log(
      "SUCCESS: Extracted JSON data with keys:",
      Object.keys(jsonData)
    );
    console.log(
      "JSON data values sample:",
      Object.entries(jsonData)
        .slice(0, 3)
        .map(
          ([k, v]) => `${k}: ${typeof v === "string" ? v.substring(0, 30) : v}`
        )
    );

    // Store the extracted values in the sheet
    const timestamp = new Date().toISOString();
    const headers = ["Timestamp", ...Object.keys(jsonData)];
    const row = [timestamp, ...Object.values(jsonData)];

    console.log("Headers for sheet:", headers);
    console.log("Row values sample:", row.slice(0, 4));
    console.log("========== SENDANY WEBHOOK DEBUG END (SUCCESS) ==========");

    // Initialize Google Sheets client
    const sheets = await getSheets();

    // Check if sheet exists, create if not
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
      });
    } catch (error) {
      if (
        error.code === 404 ||
        error.message.includes("Unable to parse range")
      ) {
        // Sheet doesn't exist, create it
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: SHEET_NAME,
                    },
                  },
                },
              ],
            },
          });

          // Add headers based on the data structure
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1`,
            valueInputOption: "USER_ENTERED",
            resource: {
              values: [headers],
            },
          });
        } catch (sheetError) {
          console.error("Error creating sheet:", sheetError);
          return res.status(500).json({
            success: false,
            error: "Failed to create sheet",
            details: sheetError.message,
          });
        }
      } else {
        throw error; // Re-throw non-404 errors
      }
    }

    // Append data
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: { values: [row] },
      });
    } catch (appendError) {
      console.error("Error appending data:", appendError);
      return res.status(500).json({
        success: false,
        error: "Failed to append data to sheet",
        details: appendError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Data successfully stored in sheet '${SHEET_NAME}'`,
      columnHeaders: headers,
      rowData: row,
    });
  } catch (error) {
    console.error("Error in /sendany endpoint:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * Helper function to manually parse a JSON-like string
 * @param {string} jsonString - The JSON string to parse
 * @returns {object} - The parsed object or null if parsing fails
 */
function parseJsonManually(jsonString) {
  try {
    // Remove braces and split by commas not in quotes
    const result = {};
    const content = jsonString.substring(1, jsonString.length - 1);

    // Split by commas not inside quotes
    let inQuote = false;
    let pairs = [];
    let currentPair = "";

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      // Handle quotes (considering escaped quotes)
      if (char === '"' && (i === 0 || content[i - 1] !== "\\")) {
        inQuote = !inQuote;
      }

      // If comma outside quotes, we have a complete pair
      if (char === "," && !inQuote) {
        pairs.push(currentPair.trim());
        currentPair = "";
      } else {
        currentPair += char;
      }
    }

    // Add the last pair
    if (currentPair.trim()) {
      pairs.push(currentPair.trim());
    }

    // Process each pair
    for (const pair of pairs) {
      // Find the colon that separates key and value
      inQuote = false;
      let colonPos = -1;

      for (let i = 0; i < pair.length; i++) {
        const char = pair[i];
        if (char === '"' && (i === 0 || pair[i - 1] !== "\\")) {
          inQuote = !inQuote;
        }

        if (char === ":" && !inQuote && colonPos === -1) {
          colonPos = i;
          break;
        }
      }

      if (colonPos > 0) {
        let key = pair.substring(0, colonPos).trim();
        let value = pair.substring(colonPos + 1).trim();

        // Clean up key - remove quotes
        key = key.replace(/^"|"$/g, "");

        // Clean up value
        if (value.startsWith('"') && value.endsWith('"')) {
          // String value
          value = value.substring(1, value.length - 1);
        } else if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else if (!isNaN(value)) {
          value = Number(value);
        }

        result[key] = value;
      }
    }

    return result;
  } catch (error) {
    console.error("Manual JSON parsing failed:", error);
    return null;
  }
}

/**
 * Emergency extraction function for the specific format seen in the logs
 * @param {string} text - The text containing JSON data
 * @returns {object} - Extracted key-value pairs
 */
function extractJsonFromText(text) {
  console.log("Using emergency extraction for specific format");
  try {
    const result = {};

    // Handle the specific format in the logs
    // Look for patterns like "Brand Name": "Simpolo" with any characters between them
    const keyValuePattern = /"([^"]+)":\s*"([^"]*)"/g;
    let match;

    // Find all key-value pairs
    while ((match = keyValuePattern.exec(text)) !== null) {
      const key = match[1];
      const value = match[2];
      if (key && value !== undefined) {
        result[key] = value;
      }
    }

    // Check for non-string values
    const nonStringValuePattern = /"([^"]+)":\s*([^",}\s][^,}]*)/g;
    while ((match = nonStringValuePattern.exec(text)) !== null) {
      const key = match[1];
      let value = match[2];

      // Convert to appropriate type
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (!isNaN(value)) value = Number(value);

      if (key && value !== undefined && !result[key]) {
        result[key] = value;
      }
    }

    console.log("Emergency extraction found keys:", Object.keys(result));
    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    console.error("Emergency extraction failed:", error);
    return null;
  }
}

// Add a debug endpoint to test the parsing
router.post("/debug", async (req, res) => {
  try {
    const rawData = req.body;
    let extractedText = null;
    let results = {
      rawDataType: typeof rawData,
      steps: [],
    };

    // First, try to extract the JSON text regardless of format
    if (typeof rawData === "string") {
      extractedText = rawData;
      results.steps.push({
        step: "Input is string",
        sample: rawData.substring(0, 100),
      });
    } else if (rawData && typeof rawData === "object") {
      results.steps.push({
        step: "Input is object",
        keys: Object.keys(rawData),
      });

      // Check if it's the pattern with Content 0 Text
      if (
        rawData.Content &&
        rawData.Content["0"] &&
        rawData.Content["0"].Text
      ) {
        extractedText = rawData.Content["0"].Text;
        results.steps.push({
          step: "Found Content[0].Text format",
          sample: extractedText.substring(0, 100),
        });
      }
      // Check array format
      else if (
        rawData.Content &&
        Array.isArray(rawData.Content) &&
        rawData.Content[0] &&
        rawData.Content[0].Text
      ) {
        extractedText = rawData.Content[0].Text;
        results.steps.push({
          step: "Found Content array format",
          sample: extractedText.substring(0, 100),
        });
      }
      // Check direct Content.Text property
      else if (rawData.Content && rawData.Content.Text) {
        extractedText = rawData.Content.Text;
        results.steps.push({
          step: "Found Content.Text format",
          sample: extractedText.substring(0, 100),
        });
      }
      // Check for directly having "2. Content 0 Text" as a key
      else if (rawData["2. Content 0 Text"]) {
        extractedText = rawData["2. Content 0 Text"];
        results.steps.push({
          step: "Found direct '2. Content 0 Text' key",
          sample: extractedText.substring(0, 100),
        });
      }
    }

    results.extractedText = extractedText
      ? extractedText.substring(0, 200)
      : null;

    // Try to parse with our specialized function
    let jsonData = null;
    if (extractedText) {
      try {
        jsonData = parseEscapedJsonFormat(extractedText);
        if (jsonData) {
          results.steps.push({
            step: "Custom parser success",
            keys: Object.keys(jsonData),
            sampleValues: Object.entries(jsonData)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", "),
          });
        } else {
          results.steps.push({ step: "Custom parser returned null" });
        }
      } catch (error) {
        results.steps.push({
          step: "Custom parser error",
          error: error.message,
        });
      }
    }

    // If no parsed data yet, try with text pattern
    if (!jsonData && extractedText && extractedText.includes("```json\\n")) {
      results.steps.push({ step: "Detected ```json\\n format" });

      // Extract the JSON content
      const exactFormatMatch = /```json\\n(.*?)\\n```/s.exec(extractedText);
      if (exactFormatMatch && exactFormatMatch[1]) {
        const jsonString = exactFormatMatch[1];
        results.steps.push({
          step: "Extracted content from format",
          sample: jsonString.substring(0, 100),
        });

        // Try direct parsing
        try {
          jsonData = JSON.parse(jsonString);
          results.steps.push({
            step: "Direct JSON.parse success",
            keys: Object.keys(jsonData),
          });
        } catch (error) {
          results.steps.push({
            step: "Direct JSON.parse failed",
            error: error.message,
          });

          // Try manual extraction
          try {
            // Remove the code block markers
            let directString = extractedText.replace(/```json\\n|\\n```/g, "");
            results.steps.push({
              step: "Cleaned string",
              sample: directString.substring(0, 100),
            });

            // Try manual string parsing
            // This is a simplified example of our manual parsing
            if (directString.includes("{") && directString.includes("}")) {
              const manualData = {};
              const keyValueMatches = directString.match(
                /"([^"]+)":\s*"([^"]*)"/g
              );

              if (keyValueMatches) {
                results.steps.push({
                  step: "Found key-value pairs",
                  count: keyValueMatches.length,
                });

                let extractedPairs = 0;
                keyValueMatches.forEach((match) => {
                  const keyMatch = /"([^"]+)":\s*/.exec(match);
                  const valueMatch = /:\s*"([^"]*)"/.exec(match);

                  if (keyMatch && keyMatch[1] && valueMatch && valueMatch[1]) {
                    manualData[keyMatch[1]] = valueMatch[1];
                    extractedPairs++;
                  }
                });

                results.steps.push({
                  step: "Extracted pairs",
                  count: extractedPairs,
                });

                if (Object.keys(manualData).length > 0) {
                  jsonData = manualData;
                  results.steps.push({
                    step: "Manual extraction success",
                    keys: Object.keys(jsonData),
                    sampleValues: Object.entries(jsonData)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", "),
                  });
                }
              }
            }
          } catch (manualError) {
            results.steps.push({
              step: "Manual extraction error",
              error: manualError.message,
            });
          }
        }
      }
    }

    // Final result
    results.success = !!jsonData;
    results.parsedData = jsonData
      ? {
          keys: Object.keys(jsonData),
          keyCount: Object.keys(jsonData).length,
          sampleEntries: Object.entries(jsonData)
            .slice(0, 5)
            .map(([k, v]) => ({ key: k, value: v })),
        }
      : null;

    return res.status(200).json(results);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
//aac
