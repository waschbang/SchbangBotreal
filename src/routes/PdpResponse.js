const express = require("express");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const Anthropic = require("@anthropic-ai/sdk");

const router = express.Router();

// Constants
const SPREADSHEET_ID = "11M2FpntvgnX-XmpWcYTD27XbbqIiGlheTFHZSpCvP1s";
const SHEET_NAME = "Responses";
const LOG_SHEET_NAME = "log";
// const AISENSY_API_KEY = "81175b599c8d27dd2fd65";
const PROJECT_ID = "67406d319db2850c4a6c8599";
const AISENSY_API_KEY = "58db869da46ee7ae400fc";
// Column indices in the main sheet (0-based)
const COLUMNS = {
  USERNAME: 0,
  TYPE: 1,
  SENDER: 2,
  PHONE_NUMBER: 3,
  MESSAGE_TYPE: 4,
  CONTENT_TEXT: 5,
  CREATED_AT: 6,
};

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey:
    "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",
});

// Track processed message IDs to avoid duplicates
const processedMessages = new Set();
let lastProcessedTimestamp = 0;
let sheets = null;
let productDatabase = []; // Cache for the entire product database

// Initialize Google Sheets
async function initSheets() {
  try {
    console.log("[PDP] Initializing Google Sheets...");
    const serviceAccountPath = path.join(__dirname, "../service-account.json");

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Service account file not found at: ${serviceAccountPath}`
      );
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    const sheetsClient = google.sheets({ version: "v4", auth: client });

    // Test the connection
    await sheetsClient.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    console.log("[PDP] Google Sheets initialized successfully");
    return sheetsClient;
  } catch (error) {
    console.error("[PDP] Error initializing Google Sheets:", error);
    throw error;
  }
}

// Function to log data to the 'log' sheet
async function logToSheet(sheets, logData) {
  try {
    const timestamp = new Date().toISOString();

    // Prepare log row data
    const logRow = [
      timestamp,
      logData.action,
      logData.phoneNumber,
      logData.userName,
      logData.productUrl || "",
      logData.productHandle || "",
      logData.status,
      logData.message || "",
      logData.error || "",
    ];

    // Check if log sheet exists, if not create it
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${LOG_SHEET_NAME}!A1:A1`,
      });
    } catch (sheetError) {
      // Sheet doesn't exist, create it
      console.log("[PDP] Creating log sheet...");
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: LOG_SHEET_NAME,
                },
              },
            },
          ],
        },
      });

      // Add headers to the new sheet
      const headers = [
        "Timestamp",
        "Action",
        "Phone Number",
        "User Name",
        "Product URL",
        "Product Handle",
        "Status",
        "Message",
        "Error",
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${LOG_SHEET_NAME}!A1:I1`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [headers],
        },
      });
    }

    // Append log data
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${LOG_SHEET_NAME}!A:I`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [logRow],
      },
    });

    console.log(
      "[PDP] Logged to sheet:",
      logData.action,
      "for",
      logData.phoneNumber
    );
  } catch (error) {
    console.error("[PDP] Error logging to sheet:", error);
  }
}

// Function to check if API key is expired
function checkTokenExpiry(apiKey) {
  try {
    const base64Url = apiKey.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join("")
    );

    const decoded = JSON.parse(jsonPayload);
    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired = decoded.exp < currentTime;

    return {
      isExpired,
      expiry: decoded.exp,
      currentTime,
      expiryDate: new Date(decoded.exp * 1000).toISOString(),
      email: decoded.email,
      projectId: decoded.projectId,
    };
  } catch (error) {
    return { isExpired: true, error: error.message };
  }
}

// Function to send message via Aisensy
async function sendAisensyMessage(phoneNumber, message, buttons = []) {
  try {
    if (!phoneNumber) {
      throw new Error("Phone number is required");
    }

    console.log("[PDP] === AISENSY API CALL DEBUG ===");
    console.log("[PDP] API Key:", AISENSY_API_KEY.substring(0, 20) + "...");
    console.log("[PDP] Project ID:", PROJECT_ID);
    console.log("[PDP] Phone Number:", phoneNumber);
    console.log("[PDP] Message Length:", message.length);
    console.log("[PDP] Buttons Count:", buttons.length);

    // Convert phone number to string and ensure it has the + prefix
    const phoneNumberStr = phoneNumber.toString();
    const cleanPhoneNumber = phoneNumberStr.startsWith("+")
      ? phoneNumberStr
      : `+${phoneNumberStr}`;

    // Try the main Aisensy endpoint
    const apiUrl = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;
    console.log("[PDP] === API REQUEST ===");
    console.log("[PDP] URL:", apiUrl);
    console.log("[PDP] Method: POST");
    console.log("[PDP] Headers:", {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY.substring(0, 20) + "...",
    });

    const payload =
      buttons && buttons.length > 0
        ? {
            to: cleanPhoneNumber,
            type: "interactive",
            recipient_type: "individual",
            interactive: {
              type: "button",
              body: {
                text: message,
              },
              action: {
                buttons: buttons.map((button, index) => ({
                  type: "reply",
                  reply: {
                    id: `btn_${index}`,
                    title: button.substring(0, 20),
                  },
                })),
              },
            },
          }
        : {
            to: cleanPhoneNumber,
            type: "text",
            recipient_type: "individual",
            text: {
              body: message,
            },
          };

    console.log("[PDP] Request Payload:", JSON.stringify(payload, null, 2));

    console.log("[PDP] Sending message to:", cleanPhoneNumber);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    console.log("[PDP] === API RESPONSE ===");
    console.log("[PDP] Status Code:", response.status);
    console.log("[PDP] Status Text:", response.statusText);
    console.log(
      "[PDP] Response Headers:",
      Object.fromEntries(response.headers.entries())
    );

    const responseText = await response.text();
    console.log("[PDP] Raw Response Body:", responseText);

    if (!response.ok) {
      const errorDetails = {
        status: response.status,
        statusText: response.statusText,
        body: responseText,
        url: apiUrl,
        payload: payload,
        timestamp: new Date().toISOString(),
      };

      console.error("[PDP] === API ERROR DETAILS ===");
      console.error("[PDP] Full Error:", JSON.stringify(errorDetails, null, 2));

      if (response.status === 401) {
        throw new Error(`API Authentication Failed: ${responseText}`);
      }

      throw new Error(
        `Aisensy API error: ${response.status} ${response.statusText} - ${responseText}`
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
      console.log("[PDP] Parsed Response:", JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.log(
        "[PDP] Response is not JSON, treating as text:",
        responseText
      );
      data = { response: responseText };
    }

    console.log("[PDP] === SUCCESS ===");
    console.log("[PDP] Message sent successfully:", data);
    return data;
  } catch (error) {
    console.error("[PDP] === AISENSY ERROR ===");
    console.error("[PDP] Error Type:", error.constructor.name);
    console.error("[PDP] Error Message:", error.message);
    console.error("[PDP] Error Stack:", error.stack);
    console.error("[PDP] Context:", {
      phoneNumber,
      messageLength: message?.length,
      buttonsCount: buttons?.length,
      apiKey: AISENSY_API_KEY.substring(0, 20) + "...",
      projectId: PROJECT_ID,
      timestamp: new Date().toISOString(),
      function: "sendAisensyMessage",
      endpoint: `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`,
    });
    throw error;
  }
}

// Function to extract product handle from URL
function extractProductHandle(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    const handle = pathParts[pathParts.length - 1].split("?")[0];
    return handle;
  } catch (error) {
    console.error("[PDP] Error extracting product handle:", error);
    return null;
  }
}

// Function to read product data from CSV
async function findProductInCSV(productHandle) {
  return new Promise((resolve, reject) => {
    if (!productHandle) {
      console.error("[PDP] No product handle provided");
      resolve(null);
      return;
    }

    const csvPath = path.join(__dirname, "../products_export.csv");
    if (!fs.existsSync(csvPath)) {
      console.error("[PDP] CSV file not found:", { csvPath });
      reject(new Error("Products CSV file not found"));
      return;
    }

    const products = [];
    console.log("[PDP] Searching for product handle:", productHandle);

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        if (row.Handle === productHandle) {
          products.push(row);
        }
      })
      .on("end", () => {
        if (products.length > 0) {
          console.log("[PDP] Found product:", products[0].Title);
          const mainProduct = products[0];
          const variants = products.map((p) => ({
            size: p["Option1 Value"],
            price: p["Variant Price"],
          }));

          resolve({
            title: mainProduct.Title,
            description: mainProduct["Body (HTML)"],
            price: mainProduct["Variant Price"],
            vendor: mainProduct.Vendor,
            category: mainProduct["Product Category"],
            type: mainProduct.Type,
            variants,
            productInfo:
              mainProduct[
                "First Tab Description (product.metafields.custom.first_tab_description)"
              ],
            additionalInfo:
              mainProduct[
                "Second Tab Description (product.metafields.custom.second_tab_description)"
              ],
            deliveryInfo:
              mainProduct[
                "Third Tab Description (product.metafields.custom.third_tab_description)"
              ],
            disclaimer:
              mainProduct[
                "Fourth Tab Description (product.metafields.custom.fourth_tab_description)"
              ],
          });
        } else {
          console.error("[PDP] Product not found in CSV:", { productHandle });
          resolve(null);
        }
      })
      .on("error", (error) => {
        console.error("[PDP] CSV reading error:", error, { productHandle });
        reject(error);
      });
  });
}

// Function to load entire product database into memory
async function loadProductDatabase() {
  return new Promise((resolve, reject) => {
    const csvPath = path.join(__dirname, "../products_export.csv");
    if (!fs.existsSync(csvPath)) {
      console.error("[PDP] CSV file not found:", { csvPath });
      reject(new Error("Products CSV file not found"));
      return;
    }

    const products = [];
    const productMap = new Map(); // To group variants by handle

    console.log("[PDP] Loading entire product database...");

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        if (row.Handle && row.Title) {
          if (!productMap.has(row.Handle)) {
            productMap.set(row.Handle, {
              handle: row.Handle,
              title: row.Title,
              description: row["Body (HTML)"],
              vendor: row.Vendor,
              category: row["Product Category"],
              type: row.Type,
              tags: row.Tags,
              price: row["Variant Price"],
              variants: [],
              productInfo:
                row[
                  "First Tab Description (product.metafields.custom.first_tab_description)"
                ],
              additionalInfo:
                row[
                  "Second Tab Description (product.metafields.custom.second_tab_description)"
                ],
              deliveryInfo:
                row[
                  "Third Tab Description (product.metafields.custom.third_tab_description)"
                ],
              disclaimer:
                row[
                  "Fourth Tab Description (product.metafields.custom.fourth_tab_description)"
                ],
            });
          }

          // Add variant
          productMap.get(row.Handle).variants.push({
            size: row["Option1 Value"],
            price: row["Variant Price"],
            sku: row["Variant SKU"],
          });
        }
      })
      .on("end", () => {
        productDatabase = Array.from(productMap.values());
        console.log(
          `[PDP] Loaded ${productDatabase.length} products into database`
        );
        resolve(productDatabase);
      })
      .on("error", (error) => {
        console.error("[PDP] Database loading error:", error);
        reject(error);
      });
  });
}

// Function to search products by name, category, or keywords
function searchProducts(query, limit = 10) {
  if (!productDatabase.length) {
    console.log("[PDP] Product database not loaded");
    return [];
  }

  const searchTerm = query.toLowerCase();
  const results = [];

  for (const product of productDatabase) {
    let score = 0;

    // Title match (highest priority)
    if (product.title.toLowerCase().includes(searchTerm)) {
      score += 10;
    }

    // Category match
    if (
      product.category &&
      product.category.toLowerCase().includes(searchTerm)
    ) {
      score += 8;
    }

    // Type match
    if (product.type && product.type.toLowerCase().includes(searchTerm)) {
      score += 6;
    }

    // Tags match
    if (product.tags && product.tags.toLowerCase().includes(searchTerm)) {
      score += 4;
    }

    // Description match
    if (
      product.description &&
      product.description.toLowerCase().includes(searchTerm)
    ) {
      score += 2;
    }

    if (score > 0) {
      results.push({ ...product, score });
    }
  }

  // Sort by score and return top results
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Function to get products by category
function getProductsByCategory(category, limit = 10) {
  if (!productDatabase.length) {
    console.log("[PDP] Product database not loaded");
    return [];
  }

  return productDatabase
    .filter(
      (product) =>
        product.category &&
        product.category.toLowerCase().includes(category.toLowerCase())
    )
    .slice(0, limit);
}

// Function to get all available categories
function getAvailableCategories() {
  if (!productDatabase.length) {
    return [];
  }

  const categories = new Set();
  productDatabase.forEach((product) => {
    if (product.category) {
      categories.add(product.category);
    }
  });

  return Array.from(categories).sort();
}

// Function to get featured/popular products
function getFeaturedProducts(limit = 5) {
  if (!productDatabase.length) {
    return [];
  }

  // Return products with higher prices as "featured" (you can modify this logic)
  return productDatabase
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, limit);
}

// Function to get Claude's response about a product
async function getProductAIResponse(productData, userQuestion) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(
        `[PDP] Getting AI response for product: ${productData.title} (Attempt ${
          attempt + 1
        }/${maxRetries})`
      );
      const message = await anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 500, // Reduced from 1000 to ensure shorter responses
        messages: [
          {
            role: "user",
            content: `Product Information:\n${JSON.stringify(
              productData,
              null,
              2
            )}\n\nUser Question: ${userQuestion}\n\nPlease provide a very concise response about this product.\n- Focus on the most important features and benefits.\n- Use bullet points for features/benefits if possible.\n- Keep the response under 150 words and within 800 characters.\n- Format: Brief overview, then bullet points for key features, price, sizes.`,
          },
        ],
      });
      return message.content[0].text;
    } catch (error) {
      console.error(
        `[PDP] Error getting AI response (Attempt ${
          attempt + 1
        }/${maxRetries}):`,
        error
      );
      if (error.status !== 529 || attempt === maxRetries - 1) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[PDP] Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Main handler for product queries
async function handleProductQuery(sheets, phoneNumber, message, userName) {
  try {
    console.log(
      "[PDP] Starting product query handling for:",
      userName,
      phoneNumber
    );

    if (!phoneNumber || !message) {
      console.error("[PDP] Missing required parameters:", {
        hasPhone: !!phoneNumber,
        hasMessage: !!message,
      });
      throw new Error("Phone number and message are required");
    }

    // Ensure product database is loaded
    if (!productDatabase.length) {
      console.log("[PDP] Loading product database...");
      await loadProductDatabase();
    }

    // Log message received
    await logToSheet(sheets, {
      action: "MESSAGE_RECEIVED",
      phoneNumber: phoneNumber,
      userName: userName,
      status: "SUCCESS",
      message: "Received product assistance request",
    });

    // Only process messages containing product URLs
    const productUrl = message.match(
      /https:\/\/www\.papadontpreach\.com\/products\/[^\s\?]*/
    )?.[0];

    if (!productUrl) {
      console.log("[PDP] Message does not contain a product URL, ignoring");
      return;
    }

    // Process the product URL
    return await handleSpecificProductUrl(
      sheets,
      phoneNumber,
      message,
      userName,
      productUrl
    );
  } catch (error) {
    console.error("[PDP] === PRODUCT QUERY HANDLING ERROR ===");
    console.error("[PDP] Error Type:", error.constructor.name);
    console.error("[PDP] Error Message:", error.message);
    console.error("[PDP] Error Stack:", error.stack);
    console.error("[PDP] Context:", { phoneNumber, message, userName });

    await logToSheet(sheets, {
      action: "ERROR_OCCURRED",
      phoneNumber: phoneNumber,
      userName: userName || "Unknown",
      status: "FAILED",
      error: error.message,
      message: "Failed to process product query",
    });

    try {
      console.log("[PDP] Attempting to send error message to user...");
      await sendAisensyMessage(
        phoneNumber,
        "I apologize, but I'm having trouble processing your request at the moment. Please try again later or contact our support team.",
        ["Need Assistance"]
      );
      console.log("[PDP] Error message sent to user successfully");
    } catch (sendError) {
      console.error("[PDP] === FAILED TO SEND ERROR MESSAGE ===");
      console.error("[PDP] Send Error Details:", sendError.message);
      console.error("[PDP] Original Error:", error.message);
      console.error("[PDP] Phone Number:", phoneNumber);

      // Log this critical failure
      await logToSheet(sheets, {
        action: "CRITICAL_ERROR_NOTIFICATION_FAILED",
        phoneNumber: phoneNumber,
        userName: userName || "Unknown",
        status: "CRITICAL_FAILURE",
        error: `Cannot notify user of error: ${sendError.message}. Original error: ${error.message}`,
        message: "System completely unable to communicate with user",
      });
    }
  }
}

// Handle specific product URL queries
async function handleSpecificProductUrl(
  sheets,
  phoneNumber,
  message,
  userName,
  productUrl
) {
  console.log("[PDP] Extracted product URL:", productUrl);

  const productHandle = extractProductHandle(productUrl);
  if (!productHandle) {
    console.error("[PDP] Could not extract product handle:", { productUrl });

    await logToSheet(sheets, {
      action: "HANDLE_EXTRACTION",
      phoneNumber: phoneNumber,
      userName: userName,
      productUrl: productUrl,
      status: "FAILED",
      error: "Could not extract product handle from URL",
    });

    await sendAisensyMessage(
      phoneNumber,
      "I couldn't process the product URL. Please make sure it's a valid Papa Don't Preach product URL.",
      ["Need Assistance"]
    );
    return;
  }

  console.log("[PDP] Extracted product handle:", productHandle);

  await logToSheet(sheets, {
    action: "URL_PROCESSED",
    phoneNumber: phoneNumber,
    userName: userName,
    productUrl: productUrl,
    productHandle: productHandle,
    status: "SUCCESS",
    message: "Successfully extracted product information from URL",
  });

  const productData = await findProductInCSV(productHandle);
  if (!productData) {
    console.error("[PDP] Product not found in database:", { productHandle });

    await logToSheet(sheets, {
      action: "PRODUCT_LOOKUP",
      phoneNumber: phoneNumber,
      userName: userName,
      productUrl: productUrl,
      productHandle: productHandle,
      status: "FAILED",
      error: "Product not found in database",
    });

    await sendAisensyMessage(
      phoneNumber,
      "I apologize, but I couldn't find this product in our database. The product might be unavailable or the URL might be incorrect.",
      ["Need Assistance"]
    );
    return;
  }

  await logToSheet(sheets, {
    action: "PRODUCT_FOUND",
    phoneNumber: phoneNumber,
    userName: userName,
    productUrl: productUrl,
    productHandle: productHandle,
    status: "SUCCESS",
    message: `Found product: ${productData.title}`,
  });

  const aiResponse = await getProductAIResponse(
    productData,
    "Give a very brief overview of this product in 2-3 sentences"
  );

  // Create a nicely formatted message
  const response = `✨ ${productData.title} ✨\n\n${aiResponse}\n\n💰 Price: ₹${
    productData.price
  }\n📏 Available Sizes: ${productData.variants.map((v) => v.size).join(", ")}`;

  await sendAisensyMessage(phoneNumber, response, [
    "Need Assistance",
    "Book an appointment",
  ]);

  await logToSheet(sheets, {
    action: "RESPONSE_SENT",
    phoneNumber: phoneNumber,
    userName: userName,
    productUrl: productUrl,
    productHandle: productHandle,
    status: "SUCCESS",
    message: `Sent product details for ${productData.title}`,
  });
}

// Handle category browsing queries
async function handleCategoryBrowsing(sheets, phoneNumber, message, userName) {
  const categories = getAvailableCategories();

  await logToSheet(sheets, {
    action: "CATEGORY_BROWSE",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "User requested category browsing",
  });

  let response = `Here are our product categories:\n\n`;
  categories.forEach((category, index) => {
    response += `${index + 1}. ${category}\n`;
  });
  response += `\nWhich category would you like to explore?`;

  await sendAisensyMessage(phoneNumber, response, [
    "Need Assistance",
    "Book an appointment",
  ]);

  await logToSheet(sheets, {
    action: "RESPONSE_SENT",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "Sent category list",
  });
}

// Handle product search queries
async function handleProductSearch(sheets, phoneNumber, message, userName) {
  // Extract search terms from message
  const searchTerms = message
    .replace(/search|looking for|find|show me/gi, "")
    .trim();

  if (!searchTerms) {
    await sendAisensyMessage(
      phoneNumber,
      "What would you like to search for?",
      ["Need Assistance", "Book an appointment"]
    );
    return;
  }

  const searchResults = searchProducts(searchTerms, 5);

  await logToSheet(sheets, {
    action: "PRODUCT_SEARCH",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: `Searched for: ${searchTerms}, found ${searchResults.length} results`,
  });

  if (searchResults.length === 0) {
    await sendAisensyMessage(
      phoneNumber,
      `I couldn't find any products matching "${searchTerms}". Would you like to browse our categories instead?`,
      ["Need Assistance", "Book an appointment"]
    );
    return;
  }

  let response = `Found ${searchResults.length} products for "${searchTerms}":\n\n`;
  searchResults.forEach((product, index) => {
    response += `${index + 1}. ${product.title}\n   Price: ₹${
      product.price
    }\n   Category: ${product.category}\n\n`;
  });

  await sendAisensyMessage(phoneNumber, response, [
    "Need Assistance",
    "Book an appointment",
  ]);

  await logToSheet(sheets, {
    action: "RESPONSE_SENT",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: `Sent search results for: ${searchTerms}`,
  });
}

// Handle general product inquiries
async function handleGeneralProductInquiry(
  sheets,
  phoneNumber,
  message,
  userName
) {
  const featuredProducts = getFeaturedProducts(5);

  await logToSheet(sheets, {
    action: "GENERAL_INQUIRY",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "User made general product inquiry",
  });

  let response = `I'd be happy to help you with Papa Don't Preach products! Here are some of our featured items:\n\n`;

  featuredProducts.forEach((product, index) => {
    response += `${index + 1}. ${product.title}\n   Price: ₹${
      product.price
    }\n   Category: ${product.category}\n\n`;
  });

  response += `What type of outfit are you looking for?`;

  await sendAisensyMessage(phoneNumber, response, [
    "Need Assistance",
    "Book an appointment",
  ]);

  await logToSheet(sheets, {
    action: "RESPONSE_SENT",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "Sent general product information",
  });
}

// Handle featured products request
async function handleFeaturedProducts(sheets, phoneNumber, message, userName) {
  const featuredProducts = getFeaturedProducts(8);

  await logToSheet(sheets, {
    action: "FEATURED_PRODUCTS",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "User requested featured products",
  });

  let response = `Here are our featured products:\n\n`;

  featuredProducts.forEach((product, index) => {
    response += `${index + 1}. ${product.title}\n   Price: ₹${
      product.price
    }\n   Category: ${product.category}\n\n`;
  });

  await sendAisensyMessage(phoneNumber, response, [
    "Need Assistance",
    "Book an appointment",
  ]);

  await logToSheet(sheets, {
    action: "RESPONSE_SENT",
    phoneNumber: phoneNumber,
    userName: userName,
    status: "SUCCESS",
    message: "Sent featured products list",
  });
}

// New endpoint to check for new messages
router.post("/check-messages", async (req, res) => {
  try {
    if (!sheets) {
      sheets = await initSheets();
    }

    // Load product database if not loaded
    if (!productDatabase.length) {
      await loadProductDatabase();
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:G`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.json({ message: "No new messages", processed: 0 });
    }

    let newMessagesProcessed = 0;
    const processedIds = new Set();

    for (const row of rows) {
      try {
        if (row.length < 7) {
          console.error("[PDP] Invalid row data:", { rowLength: row.length });
          continue;
        }

        const messageData = {
          username: row[COLUMNS.USERNAME],
          type: row[COLUMNS.TYPE],
          sender: row[COLUMNS.SENDER],
          phoneNumber: row[COLUMNS.PHONE_NUMBER].toString(),
          messageType: row[COLUMNS.MESSAGE_TYPE],
          contentText: row[COLUMNS.CONTENT_TEXT],
          createdAt: row[COLUMNS.CREATED_AT],
        };

        const messageId = `${messageData.phoneNumber}-${messageData.createdAt}`;

        if (!processedIds.has(messageId)) {
          processedIds.add(messageId);
          const content = messageData.contentText || "";

          // Check if it's a product query
          const isProductQuery =
            content.includes("papadontpreach.com/products/") ||
            content.toLowerCase().includes("assistance with") ||
            content.toLowerCase().includes("help with") ||
            content.toLowerCase().includes("product") ||
            content.toLowerCase().includes("dress") ||
            content.toLowerCase().includes("kaftan") ||
            content.toLowerCase().includes("saree") ||
            content.toLowerCase().includes("lehenga") ||
            content.toLowerCase().includes("outfit") ||
            content.toLowerCase().includes("search") ||
            content.toLowerCase().includes("looking for") ||
            content.toLowerCase().includes("find") ||
            content.toLowerCase().includes("browse") ||
            content.toLowerCase().includes("category") ||
            content.toLowerCase().includes("show me") ||
            content.toLowerCase().includes("featured") ||
            content.toLowerCase().includes("popular") ||
            content.toLowerCase().includes("recommend") ||
            content.toLowerCase().includes("best");

          if (isProductQuery) {
            await handleProductQuery(
              sheets,
              messageData.phoneNumber,
              content,
              messageData.username
            );
            newMessagesProcessed++;
          }
        }
      } catch (rowError) {
        console.error("[PDP] Row processing error:", rowError, {
          rowData: row,
        });
        continue;
      }
    }

    res.json({
      message: "Messages checked successfully",
      processed: newMessagesProcessed,
      totalMessages: rows.length,
    });
  } catch (error) {
    console.error("[PDP] Message check error:", error);
    res.status(500).json({
      error: "Failed to check messages",
      details: error.message,
    });
  }
});

// Update the status endpoint
router.get("/status", (req, res) => {
  res.json({
    status: "active",
    sheetsConnected: !!sheets,
    productsLoaded: productDatabase.length,
  });
});

// Express routes
router.get("/search/:query", async (req, res) => {
  try {
    const { query } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    if (!productDatabase.length) {
      await loadProductDatabase();
    }

    const results = searchProducts(query, limit);
    res.json({
      query,
      results: results.length,
      products: results,
    });
  } catch (error) {
    console.error("[PDP] Search endpoint error:", error);
    res.status(500).json({ error: "Search failed", details: error.message });
  }
});

router.get("/categories", async (req, res) => {
  try {
    if (!productDatabase.length) {
      await loadProductDatabase();
    }

    const categories = getAvailableCategories();
    res.json({ categories });
  } catch (error) {
    console.error("[PDP] Categories endpoint error:", error);
    res
      .status(500)
      .json({ error: "Failed to get categories", details: error.message });
  }
});

router.get("/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    if (!productDatabase.length) {
      await loadProductDatabase();
    }

    const products = getProductsByCategory(category, limit);
    res.json({
      category,
      results: products.length,
      products,
    });
  } catch (error) {
    console.error("[PDP] Category products endpoint error:", error);
    res.status(500).json({
      error: "Failed to get category products",
      details: error.message,
    });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    if (!productDatabase.length) {
      await loadProductDatabase();
    }

    const products = getFeaturedProducts(limit);
    res.json({
      results: products.length,
      products,
    });
  } catch (error) {
    console.error("[PDP] Featured products endpoint error:", error);
    res.status(500).json({
      error: "Failed to get featured products",
      details: error.message,
    });
  }
});

router.get("/product/:handle", async (req, res) => {
  try {
    const { handle } = req.params;

    const product = await findProductInCSV(handle);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ product });
  } catch (error) {
    console.error("[PDP] Product endpoint error:", error);
    res
      .status(500)
      .json({ error: "Failed to get product", details: error.message });
  }
});

// Endpoint to process a single incoming message immediately
router.post("/incoming-message", async (req, res) => {
  console.log("\n=== INCOMING MESSAGE REQUEST ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request Body:", JSON.stringify(req.body, null, 2));
  console.log("Headers:", JSON.stringify(req.headers, null, 2));

  try {
    const { phoneNumber, message, userName } = req.body;

    console.log("\n=== VALIDATING REQUEST ===");
    console.log("Phone Number:", phoneNumber);
    console.log("Message:", message);
    console.log("User Name:", userName || "Not provided");

    if (!phoneNumber || !message) {
      console.log("\n=== VALIDATION FAILED ===");
      console.log("Missing required fields:", {
        hasPhoneNumber: !!phoneNumber,
        hasMessage: !!message,
      });
      return res.status(400).json({
        error: "phoneNumber and message are required",
        received: {
          phoneNumber: !!phoneNumber,
          message: !!message,
        },
      });
    }

    console.log("\n=== INITIALIZING SERVICES ===");
    if (!sheets) {
      console.log("Initializing Google Sheets...");
      sheets = await initSheets();
      console.log("Google Sheets initialized successfully");
    }

    if (!productDatabase.length) {
      console.log("Loading product database...");
      await loadProductDatabase();
      console.log(
        `Product database loaded with ${productDatabase.length} products`
      );
    }

    console.log("\n=== PROCESSING MESSAGE ===");
    console.log("Starting product query handling...");
    await handleProductQuery(sheets, phoneNumber, message, userName || "User");
    console.log("Message processing completed successfully");

    console.log("\n=== SENDING RESPONSE ===");
    res.json({
      status: "processed",
      timestamp: new Date().toISOString(),
      details: {
        phoneNumber,
        messageLength: message.length,
        userName: userName || "User",
      },
    });
    console.log("Response sent successfully");
  } catch (error) {
    console.error("\n=== ERROR OCCURRED ===");
    console.error("Error Type:", error.constructor.name);
    console.error("Error Message:", error.message);
    console.error("Error Stack:", error.stack);
    console.error("Context:", {
      phoneNumber: req.body.phoneNumber,
      messageLength: req.body.message?.length,
      userName: req.body.userName,
    });

    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
      details: {
        type: error.constructor.name,
        message: error.message,
      },
    });
  }

  console.log("\n=== REQUEST COMPLETED ===\n");
});

module.exports = router;
