/**
 * User profile management for Aires
 * Handles extracting user data, storing conversation history, and retrieving services
 */

const { google } = require("googleapis");
const path = require("path");

// Configuration
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY";
const BRAND_INFO_SHEET = "BrandInfo";

// Store user sessions with extended fields
const userProfiles = {};

/**
 * Extract user information from webhook data
 * @param {Object} webhookData - The webhook data from AISensy
 * @returns {Object} - Extracted user information
 */
function extractUserInfo(webhookData) {
  try {
    const msg = webhookData.data.message;
    const phoneNumber = msg.phone_number || msg.sender || "";

    // Extract username from different possible locations in the webhook
    const userName =
      msg.userName ||
      msg.profile_name ||
      msg.sender_name ||
      (msg.contact && msg.contact.name) ||
      "";

    console.log(
      `Extracted user info - Phone: ${phoneNumber}, Name: ${userName}`
    );

    return {
      phoneNumber,
      userName,
    };
  } catch (error) {
    console.error("Error extracting user info:", error);
    return { phoneNumber: "", userName: "" };
  }
}

/**
 * Get or initialize user profile
 * @param {String} phoneNumber - User's phone number
 * @param {String} userName - User's name
 * @returns {Object} - User profile
 */
function getUserProfile(phoneNumber, userName = "") {
  if (!userProfiles[phoneNumber]) {
    // First time seeing this user, create new profile
    userProfiles[phoneNumber] = {
      phoneNumber,
      userName: userName || "",
      firstMessageName: userName || "", // Store the name from first message
      history: [],
      lastInteraction: Date.now(),
      csatRequested: false,
      services: {
        tech: null,
        media: null,
        solutions: null,
      },
      clientId: "",
      sbu: "",
      lastFetched: null,
    };
    console.log(
      `Created new user profile for ${phoneNumber} with name: ${userName}`
    );
  } else if (userName && !userProfiles[phoneNumber].userName) {
    // Update username if it's empty and we now have it
    userProfiles[phoneNumber].userName = userName;

    // Store first message name if not already set
    if (!userProfiles[phoneNumber].firstMessageName) {
      userProfiles[phoneNumber].firstMessageName = userName;
      console.log(
        `Updated first message name for ${phoneNumber} to: ${userName}`
      );
    }
  }

  return userProfiles[phoneNumber];
}

/**
 * Add message to user's conversation history
 * @param {String} phoneNumber - User's phone number
 * @param {String} role - Message role (user/assistant)
 * @param {String} content - Message content
 */
function addToConversationHistory(phoneNumber, role, content) {
  const profile = getUserProfile(phoneNumber);

  // Add message to history
  profile.history.push({
    role,
    content,
    timestamp: Date.now(),
  });

  // Keep last 50 messages
  if (profile.history.length > 50) {
    profile.history = profile.history.slice(-50);
  }

  // Update last interaction time
  profile.lastInteraction = Date.now();
}

/**
 * Get user's conversation history in Claude format
 * @param {String} phoneNumber - User's phone number
 * @returns {Array} - Conversation history in Claude format
 */
function getClaudeFormattedHistory(phoneNumber) {
  const profile = getUserProfile(phoneNumber);

  // Convert to Claude format (role and content only)
  return profile.history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Fetch user services from BrandInfo sheet
 * @param {Object} sheets - Google Sheets API client
 * @param {String} phoneNumber - User's phone number
 * @returns {Promise<Object>} - User services
 */
async function fetchUserServices(sheets, phoneNumber) {
  try {
    const profile = getUserProfile(phoneNumber);

    // If we've fetched this recently, use cached data
    const ONE_HOUR = 60 * 60 * 1000;
    if (profile.lastFetched && Date.now() - profile.lastFetched < ONE_HOUR) {
      return profile.services;
    }

    console.log(`Fetching services for ${phoneNumber} from BrandInfo sheet`);

    // Get all rows from BrandInfo sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${BRAND_INFO_SHEET}!A:H`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log("No data found in BrandInfo sheet");
      return null;
    }

    // Find the user's row by phone number (column A)
    const headers = rows[0];
    const userRow = rows.slice(1).find((row) => row[0] === phoneNumber);

    if (!userRow) {
      console.log(`No data found for ${phoneNumber} in BrandInfo sheet`);
      return null;
    }

    // Extract services
    const techIndex = headers.findIndex((h) => h.toLowerCase() === "tech");
    const mediaIndex = headers.findIndex((h) => h.toLowerCase() === "media");
    const solutionsIndex = headers.findIndex(
      (h) => h.toLowerCase() === "solution"
    );
    const clientIdIndex = headers.findIndex(
      (h) => h.toLowerCase() === "client_id"
    );
    const sbuIndex = headers.findIndex((h) => h.toLowerCase() === "sbu");

    console.log(
      `Service column indices - Tech: ${techIndex}, Media: ${mediaIndex}, Solutions: ${solutionsIndex}`
    );
    console.log(
      `Service values - Tech: ${userRow[techIndex]}, Media: ${userRow[mediaIndex]}, Solutions: ${userRow[solutionsIndex]}`
    );

    // Update user profile
    profile.services = {
      tech: techIndex >= 0 && userRow[techIndex] === "Y",
      media: mediaIndex >= 0 && userRow[mediaIndex] === "Y",
      solutions: solutionsIndex >= 0 && userRow[solutionsIndex] === "Y",
    };

    profile.clientId = clientIdIndex >= 0 ? userRow[clientIdIndex] : "";
    profile.sbu = sbuIndex >= 0 ? userRow[sbuIndex] : "";
    profile.lastFetched = Date.now();

    console.log(`Retrieved services for ${phoneNumber}: `, profile.services);
    return profile.services;
  } catch (error) {
    console.error(`Error fetching user services for ${phoneNumber}:`, error);
    return null;
  }
}

/**
 * Get formatted description of user's services
 * @param {String} phoneNumber - User's phone number
 * @returns {String} - Description of services
 */
function getServicesDescription(phoneNumber) {
  const profile = getUserProfile(phoneNumber);

  if (!profile.lastFetched || !profile.services) {
    return "I don't have information about your services yet.";
  }

  // Debug log to see what services are detected
  console.log(
    `Service detection for ${phoneNumber}:`,
    JSON.stringify(profile.services)
  );

  const services = [];
  if (profile.services.tech) services.push("Technology");
  if (profile.services.media) services.push("Media");
  if (profile.services.solutions) services.push("Brand Solutions");

  console.log(`Services array for ${phoneNumber}:`, services);

  if (services.length === 0) {
    return "You are not currently subscribed to any of our services.";
  } else if (services.length === 1) {
    return `You are currently using our ${services[0]} service.`;
  } else if (services.length === 2) {
    return `You are currently using our ${services[0]} and ${services[1]} services.`;
  } else {
    return `You are currently using our ${services.join(", ")} services.`;
  }
}

/**
 * Update user services directly
 * @param {String} phoneNumber - User's phone number
 * @param {Object} services - Services object with tech, media, and solutions flags
 * @returns {Object} - Updated user profile
 */
function updateUserServices(phoneNumber, services) {
  if (!phoneNumber) return null;

  // Initialize profile if it doesn't exist
  if (!userProfiles[phoneNumber]) {
    userProfiles[phoneNumber] = {
      phoneNumber,
      userName: "",
      firstMessageName: "",
      history: [],
      services: {
        tech: false,
        media: false,
        solutions: false,
      },
      lastFetched: null,
    };
  }

  // Update services
  userProfiles[phoneNumber].services = {
    tech: Boolean(services.tech),
    media: Boolean(services.media),
    solutions: Boolean(services.solutions),
  };

  userProfiles[phoneNumber].lastFetched = Date.now();

  console.log(
    `Updated services for ${phoneNumber}: ${JSON.stringify(
      userProfiles[phoneNumber].services
    )}`
  );

  return userProfiles[phoneNumber];
}

/**
 * Update user profile with additional data
 * @param {String} phoneNumber - User's phone number
 * @param {Object} profileData - Data to update in the user profile
 * @returns {Object} - Updated user profile
 */
function updateUserProfile(phoneNumber, profileData) {
  if (!phoneNumber) return null;

  // Initialize profile if it doesn't exist
  if (!userProfiles[phoneNumber]) {
    userProfiles[phoneNumber] = {
      phoneNumber,
      userName: "",
      firstMessageName: "",
      history: [],
      services: {
        tech: false,
        media: false,
        solutions: false,
      },
      lastFetched: null,
    };
  }

  // Update profile with provided data
  Object.assign(userProfiles[phoneNumber], profileData);

  console.log(
    `Updated profile for ${phoneNumber} with data: ${JSON.stringify(
      profileData
    )}`
  );

  return userProfiles[phoneNumber];
}

module.exports = {
  extractUserInfo,
  getUserProfile,
  addToConversationHistory,
  getClaudeFormattedHistory,
  fetchUserServices,
  getServicesDescription,
  updateUserServices,
  updateUserProfile,
};
