const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const path = require("path");
const moment = require("moment-timezone");
const Anthropic = require("@anthropic-ai/sdk");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch"); // Add this line
const anthropic = new Anthropic({
  apiKey:
    "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",
});

// Import Aires enhanced functionality
const { userProfileManager } = require("../lib/aires");

// Import the new intent classifier
const { classifyMessageIntent } = require("../lib/intentPatterns");

// Create Express router
const router = express.Router();
router.use(express.json({ limit: "50mb" }));

// Debug output on router initialization
console.log("storeData router initialized");

// Add debug route to verify router is working
router.get("/test", (req, res) => {
  console.log("Test route hit successfully");
  return res.status(200).json({ message: "storeData router is working" });
});

// Configuration
const AISENSY_API_KEY = "81175b599c8d27dd2fd65";
const PROJECT_ID = "671a4cf55b514e0bfccba32d";
const CLAUDE_API_KEY =
  "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";
const CSAT_TEMPLATE_ID = "65912ea8_f4ac_43a0_8dda_9f74fa6c1bb3";
const SPREADSHEET_ID = "1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY";
// Define API base URL for email service - use the actual deployed URL
const API_BASE_URL = "https://schbangbotreal.vercel.app";

async function initSheets() {
  try {
    // Try original service account path first, then fallback to credentials.json
    const serviceAccountPath = path.join(__dirname, "../service-account.json");
    console.log("Looking for service account at:", serviceAccountPath);

    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    return google.sheets({ version: "v4", auth: client });
  } catch (error) {
    console.error("Error initializing Google Sheets API:", error);
    throw error;
  }
}

// Global sheets variable
let sheets;
// Initialize sheets on startup
(async () => {
  try {
    sheets = await initSheets();
    console.log("Google Sheets API initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Google Sheets API:", error);
  }
})();

// Track user conversation state
const userSessions = {};

// Add at the top with other constants
const submittedBriefs = new Set(); // Track phone numbers that have submitted briefs

// Helper function to extract user name from message content
async function extractNameFromMessage(text, phoneNumber, requestId) {
  try {
    console.log(
      `[${requestId}] Attempting to extract name from message: "${text}"`
    );

    // If message is too short, don't try to extract name
    if (!text || text.length < 5) return null;

    // Check for common patterns indicating name
    const namePatterns = [
      /my name is ([A-Za-z\s]{2,25})/i,
      /I am ([A-Za-z\s]{2,25})/i,
      /I'm ([A-Za-z\s]{2,25})/i,
      /call me ([A-Za-z\s]{2,25})/i,
      /this is ([A-Za-z\s]{2,25})/i,
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // Clean up extracted name
        const extractedName = match[1]
          .trim()
          .replace(/[^\w\s]/g, "") // Remove special characters
          .split(" ")[0]; // Take first name only

        // Validate the extracted name (at least 2 chars, no numbers)
        if (extractedName.length >= 2 && !/\d/.test(extractedName)) {
          console.log(
            `[${requestId}] Extracted name from message: ${extractedName}`
          );

          // Update user profile with extracted name
          const userProfile = userProfileManager.getUserProfile(phoneNumber);

          // Only update if we don't already have a name
          if (!userProfile.userName) {
            userProfileManager.updateUserProfile(phoneNumber, {
              userName: extractedName,
              firstMessageName: extractedName,
            });

            console.log(
              `[${requestId}] Updated profile with extracted name: ${extractedName}`
            );
            return extractedName;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[${requestId}] Error extracting name from message:`, error);
    return null;
  }
}

// Helper function to store AI response and update session
async function storeAIResponse(requestId, phoneNumber, aiResponse) {
  try {
    // Store AI response in Google Sheets
    const aiMessageData = {
      userPhoneNumber: phoneNumber, // Explicitly pass the user's phone number
      from: "BOT",
      messageId: `ai-${Date.now()}`,
      type: "AI_RESPONSE",
      text: aiResponse,
      timestamp: Date.now(),
      userName: "AI Assistant",
      status: "SENT",
    };

    await storeMessageInSheets(
      requestId,
      aiMessageData,
      { event: "ai.response" },
      aiResponse
    );

    // Update Aires history with timestamped message
    // Replace this:
    // userProfileManager.addToConversationHistory(phoneNumber, "assistant", aiResponse);
    // With:
    addMessageWithTimestamp(phoneNumber, "assistant", aiResponse);

    console.log(`[${requestId}] Successfully stored AI response`);
  } catch (error) {
    console.error(
      `[${requestId}] Error storing AI response:`,
      error.response?.data || error.message || error
    );
    // Continue without failing - this is non-critical
  }
}

// Main webhook endpoint
router.post("/", async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = requestStartTime.toString();

  // Get user's message timestamp from the webhook data
  const userMessageTimestamp = req.body?.data?.message?.sent_at || Date.now();
  console.log(
    `[${requestId}] User message was sent at: ${new Date(
      userMessageTimestamp
    ).toISOString()}`
  );

  console.log(
    `[${requestId}] Starting webhook processing at ${new Date(
      requestStartTime
    ).toISOString()}`
  );
  console.log(
    `[${requestId}] Time between user message and webhook receipt: ${
      requestStartTime - userMessageTimestamp
    }ms`
  );

  try {
    // Simplified completeResponse or direct usage of res.status().send()
    const completeResponse = (status, message) => {
      if (!res.headersSent) {
        res.status(status).send(message);
      }
      return null;
    };

    // Extract webhook data
    const webhookData = req.body;

    // Check if this is a message from a user
    if (webhookData.topic !== "message.sender.user") {
      return completeResponse(200, "Not a user message");
    }

    // Extract message data
    const message = webhookData.data.message;
    const phoneNumber = message.phone_number;
    const userName = message.userName || "";
    const messageTimestamp = message.sent_at || Date.now();

    // Check if message is too old (more than 30 seconds)
    const messageAge = Date.now() - messageTimestamp;
    const MAX_MESSAGE_AGE = 30 * 1000; // 30 seconds in milliseconds

    if (messageAge > MAX_MESSAGE_AGE) {
      console.log(
        `[${requestId}] Message is ${messageAge}ms old, exceeding maximum age of ${MAX_MESSAGE_AGE}ms. Ignoring.`
      );
      return completeResponse(200, "Message too old, ignoring");
    }

    // Extract message content
    let messageText = "";
    let isInteractiveMessage = false;
    let buttonOrListTitle = "";

    if (
      message.message_type === "TEXT" &&
      message.message_content &&
      message.message_content.text
    ) {
      messageText = message.message_content.text;
    } else if (message.type === "interactive" && message.interactive) {
      isInteractiveMessage = true;
      if (message.interactive.type === "button_reply") {
        messageText = message.interactive.button_reply.title || "";
        buttonOrListTitle = messageText;

        // Handle button responses
        if (message.interactive.button_reply.id === "submit_brief") {
          console.log(`[${requestId}] User clicked Submit Brief button`);
          await sendBriefTemplate(phoneNumber, requestId);
          await storeMessageInSheets(requestId, {
            from: "BOT",
            text: "Sent brief template from button click",
            type: "TEMPLATE",
            timestamp: Date.now(),
          });
          return completeResponse(200, "Brief template sent from button");
        } else if (message.interactive.button_reply.id === "talk_to_team") {
          console.log(`[${requestId}] User clicked Talk to Team button`);
          await sendHumanTemplate(phoneNumber, requestId);
          await storeMessageInSheets(requestId, {
            from: "BOT",
            text: "Sent human escalation template from button click",
            type: "TEMPLATE",
            timestamp: Date.now(),
          });
          return completeResponse(
            200,
            "Human escalation template sent from button"
          );
        }
      } else if (message.interactive.type === "list_reply") {
        messageText = message.interactive.list_reply.title || "";
        buttonOrListTitle = messageText;
      }
    } else if (
      message.message_type === "BUTTON_REPLY" &&
      message.message_content &&
      message.message_content.title
    ) {
      isInteractiveMessage = true;
      messageText = message.message_content.title || "";
      buttonOrListTitle = messageText;

      // Handle button responses
      if (message.message_content.id === "submit_brief") {
        console.log(`[${requestId}] User clicked Submit Brief button`);
        await sendBriefTemplate(phoneNumber, requestId);
        await storeMessageInSheets(requestId, {
          from: "BOT",
          text: "Sent brief template from button click",
          type: "TEMPLATE",
          timestamp: Date.now(),
        });
        return completeResponse(200, "Brief template sent from button");
      } else if (message.message_content.id === "talk_to_team") {
        console.log(`[${requestId}] User clicked Talk to Team button`);
        await sendHumanTemplate(phoneNumber, requestId);
        await storeMessageInSheets(requestId, {
          from: "BOT",
          text: "Sent human escalation template from button click",
          type: "TEMPLATE",
          timestamp: Date.now(),
        });
        return completeResponse(
          200,
          "Human escalation template sent from button"
        );
      }
    } else if (
      message.message_type === "QUICK_REPLY" &&
      message.message_content &&
      message.message_content.text
    ) {
      isInteractiveMessage = true;
      messageText = message.message_content.text || "";
      buttonOrListTitle = messageText;
    } else if (
      message.message_type === "NFM_REPLY" ||
      (message.message_content && message.message_content.response_json) ||
      (message.message_content && message.message_content.name === "flow")
    ) {
      console.log(
        `[${requestId}] Form response detected. No response will be sent.`
      );

      const isCSATResponse =
        message.message_content &&
        (message.message_content.text?.toLowerCase().includes("csat") ||
          message.message_content.name?.toLowerCase().includes("csat") ||
          (message.message_content.response_json &&
            JSON.stringify(message.message_content.response_json)
              .toLowerCase()
              .includes("csat")));

      if (isCSATResponse) {
        console.log(
          `[${requestId}] CSAT form response detected for ${phoneNumber}`
        );
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "June",
          "July",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const currentMonth = months[new Date().getMonth()];
        const userProfile = userProfileManager.getUserProfile(phoneNumber);
        if (!userProfile.monthlyCSAT) {
          userProfile.monthlyCSAT = {};
        }
        const previousStatus =
          userProfile.monthlyCSAT[currentMonth] || "Not filled";
        console.log(
          `[${requestId}] Previous CSAT status for ${currentMonth}: ${previousStatus}`
        );
        userProfile.monthlyCSAT[currentMonth] = "Y";
        userProfileManager.updateUserProfile(phoneNumber, {
          monthlyCSAT: userProfile.monthlyCSAT,
        });
        console.log(
          `[${requestId}] Updated CSAT status for ${phoneNumber} - ${currentMonth}: Y`
        );
        console.log(
          `[${requestId}] All monthly CSAT statuses:`,
          JSON.stringify(userProfile.monthlyCSAT, null, 2)
        );
        // --- NEW: Append to CSAT_Log ---
        await appendCSATLog({
          phoneNumber,
          userName: message.userName || userProfile.userName || "",
          month: currentMonth,
          responseJson:
            message.message_content.response_json ||
            message.message_content.text ||
            "",
          rawMessage: message,
          requestId,
        });
      }

      await storeMessageInSheets(
        requestId,
        {
          from: "USER",
          text: "(form response)",
          type: "FORM_RESPONSE",
          userName: message.userName || "",
        },
        webhookData,
        "(form response)"
      );

      return completeResponse(
        200,
        "Form response processed - no response needed"
      );
    }

    const messageData = {
      messageId: message.messageId || "",
      from: phoneNumber,
      type: message.type || "message",
      text: messageText,
      timestamp: message.sent_at || Date.now(),
      userName: userName,
      status: message.status || "",
      raw: message,
    };

    console.log(
      `[${requestId}] Extracted message data:`,
      JSON.stringify(messageData, null, 2)
    );

    // Check for special triggers BEFORE any other processing
    const specialTriggers = [
      "Fill Now",
      "Start Now",
      "Share Feedback",
      "Start Feedback",
      "fill the feedback form",
      "Explore",
      "Click Here To Fill",
      "Click Here To Start",
      "GGF",
      "Explore Our Academy",
      "Maybe Later",
      "Yes",
      "Input Form",
      "Skill Up My Team",
      "Share My Thoughts",
      "Inspire Me",
      "Our Services",
      "Menu",
      "Yes!",
      "Let's Partner Up",
      "Services",
      "CSAT",
      "hey",
      "hello",
      "Hello",
      "helo",
      "Hi",
      "hi",
      "Hye",
      "Hey",
      "Yo",
      "yo",
      "See Our Work",
      "Browse Case Studies",
      "Browse Case Studies!",
      "Fill the Form",
    ];

    // Add debug logging for special trigger check
    console.log(
      `[${requestId}] Checking if "${messageText}" is a special trigger`
    );
    console.log(
      `[${requestId}] Message type: ${
        isInteractiveMessage ? "interactive" : "text"
      }`
    );

    // Check for exact match with special triggers
    const isSpecialTrigger = specialTriggers.includes(messageText);

    if (isSpecialTrigger) {
      console.log(
        `[${requestId}] Special trigger word detected: "${messageText}". No response will be sent.`
      );

      // Special handling for "See Our Work"
      if (messageText === "See Our Work") {
        console.log(
          `[${requestId}] Sending reels carousel for "See Our Work" trigger`
        );
        await sendReelsCarousel(phoneNumber, requestId);
        await storeMessageInSheets(
          requestId,
          {
            userPhoneNumber: phoneNumber,
            from: "BOT",
            text: "Sent reels carousel",
            type: "TEMPLATE",
            userName: "AI Assistant",
          },
          webhookData,
          "Sent reels carousel"
        );
        return completeResponse(
          200,
          "Reels carousel sent for See Our Work trigger"
        );
      }

      // Handle Browse Case Studies trigger
      if (
        messageText === "Browse Case Studies" ||
        messageText === "Browse Case Studies!"
      ) {
        console.log(`[${requestId}] Browse Case Studies trigger detected`);
        await sendReelsCarousel(phoneNumber, requestId);
        await storeMessageInSheets(
          requestId,
          {
            userPhoneNumber: phoneNumber,
            from: "BOT",
            text: `Sent reels carousel from Browse Case Studies trigger`,
            type: "TEMPLATE",
            userName: "AI Assistant",
          },
          webhookData,
          `Sent reels carousel from Browse Case Studies trigger`
        );
        return completeResponse(
          200,
          "Reels carousel sent from Browse Case Studies trigger"
        );
      }

      await storeMessageInSheets(
        requestId,
        messageData,
        webhookData,
        messageText
      );
      return completeResponse(
        200,
        "Special trigger processed - no response needed"
      );
    }

    // Remove the duplicate special triggers check from here
    await storeMessageInSheets(
      requestId,
      messageData,
      webhookData,
      messageText
    );

    console.log(
      `[${requestId}] Fetching BrandInfo data for number: ${phoneNumber}`
    );

    // The processWebhook function contains the core logic and can take time.
    // It's called either directly or in the background if timeout occurs.
    const processWebhook = async () => {
      const processStartTime = Date.now();
      console.log(
        `[${requestId}] Starting processWebhook at ${
          processStartTime - requestStartTime
        }ms from request start`
      );

      try {
        const session = userProfileManager.getUserProfile(
          phoneNumber,
          userName
        );

        const brandInfoData = await getBrandInfoData(
          phoneNumber,
          requestId,
          session
        );
        console.log(
          `[${requestId}] BRANDINFO DATA for ${phoneNumber}:`,
          brandInfoData
        );

        if (brandInfoData && brandInfoData["Phone Number"]) {
          const specialTriggers = [
            "Fill Now",
            "Share Feedback",
            "Start Now",
            "Start Feedback",
            "fill the feedback form",
            "Explore",
            "Click Here To Fill",
            "Click Here To Start",
            "GGF",
            "Explore Our Academy",
            "Maybe Later",
            "Yes",
            "Input Form",
            "Skill Up My Team",
            "Share My Thoughts",
            "Inspire Me",
            "Our Services",
            "Menu",
            "Yes!",
            "Let's Partner Up",
            "Services",
            "CSAT",
            "hey",
            "hello",
            "Hello",
            "helo",
            "Hi",
            "hi",
            "Hye",
            "Hey",
            "Yo",
            "yo",
            "See Our Work",
            "Browse Case Studies",
            "Browse Case Studies!",
            "Share Feedback",
            "Fill the Form",
          ];

          const textToCheck = isInteractiveMessage
            ? buttonOrListTitle
            : messageText;

          console.log(
            `[${requestId}] Checking if "${textToCheck}" is a special trigger`
          );
          console.log(
            `[${requestId}] Message type: ${
              isInteractiveMessage ? "interactive" : "text"
            }`
          );
          console.log(
            `[${requestId}] Button/List title: ${buttonOrListTitle || "N/A"}`
          );

          // Normalize both strings for comparison
          const normalizedInput = textToCheck.toLowerCase().trim();
          const isSpecialTrigger = specialTriggers.some(
            (trigger) => trigger.toLowerCase().trim() === normalizedInput
          );

          if (isSpecialTrigger) {
            console.log(
              `[${requestId}] Special trigger word detected: "${textToCheck}". No response will be sent.`
            );

            // Special handling for "See Our Work"
            if (normalizedInput === "see our work") {
              console.log(
                `[${requestId}] Sending reels carousel for "See Our Work" trigger`
              );
              await sendReelsCarousel(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: "Sent reels carousel",
                  type: "TEMPLATE",
                  userName: "AI Assistant",
                },
                webhookData,
                "Sent reels carousel"
              );
              return completeResponse(
                200,
                "Reels carousel sent for See Our Work trigger"
              );
            }

            // Handle Browse Case Studies trigger
            if (
              normalizedInput === "browse case studies" ||
              normalizedInput === "browse case studies!"
            ) {
              console.log(
                `[${requestId}] Browse Case Studies trigger detected`
              );
              await sendReelsCarousel(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: `Sent reels carousel from Browse Case Studies trigger`,
                  type: "TEMPLATE",
                  userName: "AI Assistant",
                },
                webhookData,
                `Sent reels carousel from Browse Case Studies trigger`
              );
              return completeResponse(
                200,
                "Reels carousel sent from Browse Case Studies trigger"
              );
            }

            await storeMessageInSheets(
              requestId,
              messageData,
              webhookData,
              messageText
            );
            return completeResponse(
              200,
              "Special trigger processed - no response needed"
            );
          }

          await storeMessageInSheets(
            requestId,
            messageData,
            webhookData,
            messageText
          );

          const conversationHistory =
            session && session.history ? session.history : [];
          const previousMessages = conversationHistory
            .slice(-3)
            .filter((msg) => msg.role === "user")
            .map((msg) => msg.content);

          // Add timing for intent classification
          const intentStartTime = Date.now();
          const messageIntent = await handleMessageIntent(
            messageText,
            previousMessages
          );
          const intentEndTime = Date.now();
          console.log(
            `[${requestId}] Intent classification completed in ${
              intentEndTime - intentStartTime
            }ms`
          );

          // Handle Agency Reel requests first
          if (messageIntent.isAskingAboutAgencyReel) {
            console.log(`[${requestId}] Agency reel request detected`);
            try {
              await sendAgencyReelVideo(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: "Sent agency reel video",
                  type: "VIDEO",
                  userName: "AI Assistant",
                },
                webhookData,
                "Sent agency reel video"
              );
              // Also store in conversation history
              addMessageWithTimestamp(
                phoneNumber,
                "assistant",
                "Sent 2025 Agency Reel video"
              );
              return completeResponse(200, "Agency reel request processed");
            } catch (error) {
              console.error(`[${requestId}] Error sending agency reel:`, error);
              await sendTextMessage(
                phoneNumber,
                "Sorry, I encountered an issue sending the video. Please try asking for the agency reel again.",
                true
              );
              return completeResponse(
                500,
                "Error processing agency reel request"
              );
            }
          }

          // Handle general reels request
          if (
            messageIntent.isAskingAboutReels &&
            !messageIntent.isAskingAboutAgencyReel
          ) {
            // Check if the message explicitly asks for reels
            const messageTextLower = messageText.toLowerCase();
            const containsExplicitReelsRequest =
              messageTextLower.includes("reel") ||
              messageTextLower.includes("reels");

            if (!containsExplicitReelsRequest) {
              // If not explicitly asking for reels, process as a normal message
              console.log(
                `[${requestId}] Message mentions reels but not explicitly requesting them`
              );
              // Continue to normal message processing
            } else {
              console.log(`[${requestId}] Explicit reels request detected`);
              try {
                // Send reels carousel first
                await sendReelsCarousel(phoneNumber, requestId);

                // Store data after sending response
                await Promise.all([
                  storeMessageInSheets(
                    requestId,
                    {
                      userPhoneNumber: phoneNumber,
                      from: "BOT",
                      text: "Sent reels carousel",
                      type: "TEMPLATE",
                      userName: "AI Assistant",
                    },
                    webhookData,
                    "Sent reels carousel"
                  ),
                  // Store in conversation history
                  addMessageWithTimestamp(
                    phoneNumber,
                    "assistant",
                    "Sent latest reels carousel"
                  ),
                ]);

                return completeResponse(200, "Reels request processed");
              } catch (error) {
                console.error(`[${requestId}] Error sending reels:`, error);
                await sendTextMessage(
                  phoneNumber,
                  "Sorry, I encountered an issue sending the reels. Please try asking for the reels again.",
                  true
                );
                return completeResponse(500, "Error processing reels request");
              }
            }
          }

          // Handle Company Info requests second
          if (messageIntent.isCompanyInfo) {
            console.log(
              `[${requestId}] Company information request detected in processWebhook`
            );
            const claudeStartTime = Date.now();
            console.log(
              `[${requestId}] Starting Claude response generation at ${
                claudeStartTime - requestStartTime
              }ms from request start`
            );

            const aiResponse = await getClaudeResponse(
              messageText,
              null, // History will be fetched by DynamoDB within getClaudeResponse
              phoneNumber,
              messageIntent,
              "User is asking for general information about Schbang (e.g., founder, history, awards)."
            );

            const claudeEndTime = Date.now();
            console.log(
              `[${requestId}] Claude response generated in ${
                claudeEndTime - claudeStartTime
              }ms`
            );

            // Add timing for message sending
            const sendStartTime = Date.now();
            await sendTextMessage(phoneNumber, aiResponse);
            const sendEndTime = Date.now();

            // Calculate and log total end-to-end time
            const totalProcessingTime = sendEndTime - userMessageTimestamp;
            const totalSystemTime = sendEndTime - requestStartTime;

            console.log(`[${requestId}] ====== Timing Summary ======`);
            console.log(
              `[${requestId}] User message sent at: ${new Date(
                userMessageTimestamp
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Webhook received at: ${new Date(
                requestStartTime
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Response sent at: ${new Date(
                sendEndTime
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Time from user message to response: ${totalProcessingTime}ms`
            );
            console.log(
              `[${requestId}] Time from webhook receipt to response: ${totalSystemTime}ms`
            );
            console.log(
              `[${requestId}] Webhook processing overhead: ${
                requestStartTime - userMessageTimestamp
              }ms`
            );
            console.log(
              `[${requestId}] Claude processing time: ${
                claudeEndTime - claudeStartTime
              }ms`
            );
            console.log(
              `[${requestId}] Message sending time: ${
                sendEndTime - sendStartTime
              }ms`
            );
            console.log(`[${requestId}] ==========================`);

            await storeAIResponse(
              requestId,
              phoneNumber,
              aiResponse,
              userProfileManager.getUserProfile(
                phoneNumber
              ) /* or appropriate session object */
            );
            return completeResponse(200, "Company info request processed");
          }

          // Handle negative sentiment immediately
          if (messageIntent.isNegativeSentiment) {
            console.log(
              `[${requestId}] Negative sentiment detected in processWebhook from ${phoneNumber}`
            );
            const sendStartTime = Date.now();
            await sendNegativeFeedbackTemplate(phoneNumber, requestId);
            const sendEndTime = Date.now();

            // Calculate and log total end-to-end time
            const totalProcessingTime = sendEndTime - userMessageTimestamp;
            const totalSystemTime = sendEndTime - requestStartTime;

            console.log(`[${requestId}] ====== Timing Summary ======`);
            console.log(
              `[${requestId}] User message sent at: ${new Date(
                userMessageTimestamp
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Webhook received at: ${new Date(
                requestStartTime
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Response sent at: ${new Date(
                sendEndTime
              ).toISOString()}`
            );
            console.log(
              `[${requestId}] Time from user message to response: ${totalProcessingTime}ms`
            );
            console.log(
              `[${requestId}] Time from webhook receipt to response: ${totalSystemTime}ms`
            );
            console.log(
              `[${requestId}] Template sending time: ${
                sendEndTime - sendStartTime
              }ms`
            );
            console.log(`[${requestId}] ==========================`);
            // Also store in conversation history
            await storeMessageInSheets(
              requestId,
              {
                userPhoneNumber: phoneNumber,
                from: "BOT",
                text: "Sent negative_feedback_working_new template",
                type: "TEMPLATE",
                userName: "AI Assistant",
              },
              { event: "negative.feedback.template" },
              "Sent negative_feedback_working_new template"
            );
            return completeResponse(200, "Negative sentiment template sent");
          }

          // Handle general feedback requests
          if (messageIntent.isRequestingFeedback) {
            console.log(
              `[${requestId}] Feedback request detected, sending normal feedback template`
            );
            await sendNormalFeedbackTemplate(phoneNumber, requestId);
            await storeMessageInSheets(requestId, {
              from: "BOT",
              text: "Sent normal feedback template",
              type: "TEMPLATE",
              timestamp: Date.now(),
            });
            return completeResponse(200, "Feedback request template sent");
          } else {
            // Handle contact requests
            if (messageIntent.isAskingAboutWork) {
              console.log(`[${requestId}] Work showcase request detected`);
              await sendReelsCarousel(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: `Sent reels carousel`,
                  type: "TEMPLATE",
                  userName: "AI Assistant",
                },
                webhookData,
                `Sent reels carousel`
              );
              return completeResponse(200, "Reels carousel request processed");
            }

            // Handle team queries
            if (messageIntent.isAskingAboutTeam) {
              console.log(`[${requestId}] Team query detected`);

              try {
                // Get brand info to fetch team data
                const brandInfo = await getBrandInfoData(
                  phoneNumber,
                  requestId
                );

                let teamResponse = "";
                if (brandInfo && brandInfo["Team"]) {
                  const teamMembers = brandInfo["Team"];
                  teamResponse = `Here's the team who is working closely on your brand and the CSAT you fill every month is for them: *${teamMembers}*. They are dedicated to delivering exceptional results for your brand.`;
                } else {
                  teamResponse =
                    "I couldn't find team information for your account. Please contact our support team for assistance.";
                }

                await sendTextMessage(phoneNumber, teamResponse);
                await storeMessageInSheets(
                  requestId,
                  {
                    userPhoneNumber: phoneNumber,
                    from: "BOT",
                    text: teamResponse,
                    type: "AI_RESPONSE",
                    userName: "AI Assistant",
                  },
                  webhookData,
                  teamResponse
                );
                // Also store in DynamoDB for conversation history
                addMessageWithTimestamp(phoneNumber, "assistant", teamResponse);
                return completeResponse(200, "Team query processed");
              } catch (error) {
                console.error(
                  `[${requestId}] Error processing team query:`,
                  error
                );
                throw error; // Let the main error handler deal with it
              }
            }

            if (
              messageIntent.isRequestingToFillCSAT ||
              messageIntent.isRequestingCSATViaEmail
            ) {
              console.log(
                `[${requestId}] CSAT request detected, processing...`
              );

              // Get user profile first
              const userProfile = userProfileManager.getUserProfile(
                phoneNumber
              );

              // Check if user is a client first
              const brandInfo = await getBrandInfoData(
                phoneNumber,
                requestId,
                userProfile
              );
              if (!brandInfo || !brandInfo["Phone Number"]) {
                console.log(
                  `[${requestId}] Non-client requesting CSAT, sending appropriate message`
                );
                await sendTextMessage(
                  phoneNumber,
                  "To help you connect with Team Schbang, we'd love to know more about your brand. You can start by sharing a quick brief!"
                );
                await sendBriefTemplate(phoneNumber, requestId);
                await storeMessageInSheets(requestId, {
                  from: "BOT",
                  text: "Sent non-client CSAT request response and brief template",
                  type: "TEMPLATE",
                  timestamp: Date.now(),
                });
                return completeResponse(200, "Non-client CSAT request handled");
              }

              // Get current month
              const months = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "June",
                "July",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec",
              ];
              const currentMonth = months[new Date().getMonth()];
              console.log(`[${requestId}] Current month: ${currentMonth}`);

              if (messageIntent.isRequestingToFillCSAT) {
                // Check if user has already filled CSAT for current month
                if (
                  userProfile &&
                  userProfile.monthlyCSAT &&
                  userProfile.monthlyCSAT[currentMonth] === "Y"
                ) {
                  console.log(
                    `[${requestId}] User already filled CSAT for ${currentMonth}`
                  );

                  // Log all months status for debugging
                  console.log(
                    `[${requestId}] All monthly CSAT statuses for ${phoneNumber}:`
                  );
                  if (userProfile.monthlyCSAT) {
                    for (const month of months) {
                      const status =
                        userProfile.monthlyCSAT[month] || "Not filled";
                      console.log(`[${requestId}] ${month}: ${status}`);
                    }
                  }

                  await sendTextMessage(
                    phoneNumber,
                    `You have already filled the CSAT form for ${currentMonth}. Thank you for your feedback!`
                  );

                  // Store that we handled this message
                  await storeMessageInSheets(
                    requestId,
                    {
                      userPhoneNumber: phoneNumber,
                      from: "BOT",
                      text: `CSAT already filled for ${currentMonth}`,
                      type: "AI_RESPONSE",
                      userName: "AI Assistant",
                    },
                    webhookData,
                    `CSAT already filled for ${currentMonth}`
                  );
                  // Also store in DynamoDB for conversation history
                  addMessageWithTimestamp(
                    phoneNumber,
                    "assistant",
                    `CSAT already filled for ${currentMonth}`
                  );

                  if (!res.headersSent) {
                    res.status(200).json({
                      success: true,
                      message: "CSAT already filled response sent",
                    });
                  }
                  return;
                }

                // If not filled yet, send the CSAT template via WhatsApp
                await sendCSATTemplate(phoneNumber, requestId);
                await storeMessageInSheets(
                  requestId,
                  {
                    userPhoneNumber: phoneNumber,
                    from: "BOT",
                    text: "Sent CSAT Template",
                    type: "TEMPLATE",
                  },
                  webhookData,
                  "Sent CSAT Template"
                );
                // Also store in DynamoDB for conversation history
                addMessageWithTimestamp(
                  phoneNumber,
                  "assistant",
                  "Sent CSAT Template"
                );
                return completeResponse(200, "CSAT WhatsApp request processed");
              } else if (messageIntent.isRequestingCSATViaEmail) {
                // Check if user has already filled CSAT for current month
                if (
                  userProfile &&
                  userProfile.monthlyCSAT &&
                  userProfile.monthlyCSAT[currentMonth] === "Y"
                ) {
                  console.log(
                    `[${requestId}] User already filled CSAT for ${currentMonth}`
                  );

                  await sendTextMessage(
                    phoneNumber,
                    `You have already filled the CSAT form for ${currentMonth}. Thank you for your feedback!`
                  );

                  // Store that we handled this message
                  await storeMessageInSheets(
                    requestId,
                    {
                      userPhoneNumber: phoneNumber,
                      from: "BOT",
                      text: `CSAT already filled for ${currentMonth}`,
                      type: "AI_RESPONSE",
                      userName: "AI Assistant",
                    },
                    webhookData,
                    `CSAT already filled for ${currentMonth}`
                  );

                  if (!res.headersSent) {
                    res.status(200).json({
                      success: true,
                      message: "CSAT already filled response sent",
                    });
                  }
                  return;
                }

                // Get brand info to retrieve email
                const brandInfo = await getBrandInfoData(
                  phoneNumber,
                  requestId,
                  userProfile
                );

                if (brandInfo && brandInfo["Email"]) {
                  const userEmail = brandInfo["Email"];
                  console.log(
                    `[${requestId}] Found email address: ${userEmail}`
                  );

                  // Send CSAT form via email
                  const emailSent = await sendCSATViaEmail(
                    userEmail,
                    requestId,
                    phoneNumber
                  );

                  if (emailSent) {
                    await sendTextMessage(
                      phoneNumber,
                      `I've sent the CSAT form to your email address (${userEmail}). Please check your inbox.`
                    );

                    // Store that we handled this message
                    await storeMessageInSheets(
                      requestId,
                      {
                        userPhoneNumber: phoneNumber,
                        from: "BOT",
                        text: `Sent CSAT form via email to ${userEmail}`,
                        type: "AI_RESPONSE",
                        userName: "AI Assistant",
                      },
                      webhookData,
                      `Sent CSAT form via email to ${userEmail}`
                    );
                    // Also store in DynamoDB for conversation history
                    addMessageWithTimestamp(
                      phoneNumber,
                      "assistant",
                      `Sent CSAT form via email to ${userEmail}`
                    );

                    if (!res.headersSent) {
                      res.status(200).json({
                        success: true,
                        message: "CSAT Email request processed",
                      });
                    }
                    return;
                  } else {
                    await sendTextMessage(
                      phoneNumber,
                      "Sorry, I couldn't send the CSAT form to your email. Let me send it here instead."
                    );

                    // Fall back to WhatsApp template
                    await sendCSATTemplate(phoneNumber, requestId);

                    // Store that we handled this message
                    await storeMessageInSheets(
                      requestId,
                      {
                        userPhoneNumber: phoneNumber,
                        from: "BOT",
                        text: `Sent CSAT template (email failed)`,
                        type: "TEMPLATE",
                        userName: "AI Assistant",
                      },
                      webhookData,
                      `Sent CSAT template (email failed)`
                    );
                    // Also store in DynamoDB for conversation history
                    addMessageWithTimestamp(
                      phoneNumber,
                      "assistant",
                      "Sent CSAT template (email failed)"
                    );

                    if (!res.headersSent) {
                      res.status(200).json({
                        success: true,
                        message: "CSAT Email fallback processed",
                      });
                    }
                    return;
                  }
                } else {
                  await sendTextMessage(
                    phoneNumber,
                    "I couldn't find your email address in our records. Let me send the CSAT form here instead."
                  );

                  // Fall back to WhatsApp template
                  await sendCSATTemplate(phoneNumber, requestId);

                  // Store that we handled this message
                  await storeMessageInSheets(
                    requestId,
                    {
                      userPhoneNumber: phoneNumber,
                      from: "BOT",
                      text: `Sent CSAT template (no email found)`,
                      type: "TEMPLATE",
                      userName: "AI Assistant",
                    },
                    webhookData,
                    `Sent CSAT template (no email found)`
                  );
                  // Also store in DynamoDB for conversation history
                  addMessageWithTimestamp(
                    phoneNumber,
                    "assistant",
                    "Sent CSAT template (no email found)"
                  );

                  if (!res.headersSent) {
                    res.status(200).json({
                      success: true,
                      message: "CSAT Email fallback processed",
                    });
                  }
                  return;
                }
              }
            } else if (messageIntent.isAskingAboutTraining) {
              console.log(
                `[${requestId}] Training request detected, sending template`
              );
              await sendTrainingTemplate(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: `Sent traning_form template`,
                  type: "TEMPLATE",
                  userName: "AI Assistant",
                },
                webhookData,
                `Sent traning_form template`
              );
              // Also store in DynamoDB for conversation history
              addMessageWithTimestamp(
                phoneNumber,
                "assistant",
                "Sent training form template"
              );
              return completeResponse(200, "Training request processed");
            } else if (messageIntent.isShortResponse) {
              console.log(
                `[${requestId}] Short response detected, using context for response`
              );
              const aiResponse = await getClaudeResponse(
                messageText,
                userProfileManager.getClaudeFormattedHistory(phoneNumber),
                phoneNumber,
                messageIntent,
                "This is a short response like 'yes', 'no', 'ok', etc. Use conversation context to respond appropriately."
              );
              await sendTextMessage(phoneNumber, aiResponse);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: aiResponse,
                  type: "AI_RESPONSE",
                  userName: "AI Assistant",
                },
                webhookData,
                aiResponse
              );
              // Also store in DynamoDB for conversation history
              addMessageWithTimestamp(phoneNumber, "assistant", aiResponse);
              return completeResponse(
                200,
                "Short response processed with context"
              );
            } else if (messageIntent.isGreeting) {
              console.log(
                `[${requestId}] Greeting detected, sending personalized response`
              );
              const userProfile = userProfileManager.getUserProfile(
                phoneNumber
              );
              const userName =
                userProfile.userName || userProfile.firstMessageName || "";
              const timeGreeting = getTimeBasedGreeting();
              let greeting;
              if (userName) {
                const greetingOptions = [
                  `${timeGreeting}, ${userName}! How can I help you today?`,
                  `Hi ${userName}! What can I do for you?`,
                  `Hello ${userName}! How may I assist you?`,
                ];
                greeting =
                  greetingOptions[
                    Math.floor(Math.random() * greetingOptions.length)
                  ];
              } else {
                const greetingOptions = [
                  `${timeGreeting}! How can I help you today?`,
                  `Hello there! What can I do for you?`,
                  `Hi! How may I assist you?`,
                ];
                greeting =
                  greetingOptions[
                    Math.floor(Math.random() * greetingOptions.length)
                  ];
              }
              await sendTextMessage(phoneNumber, greeting);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: greeting,
                  type: "AI_RESPONSE",
                  userName: "AI Assistant",
                },
                webhookData,
                greeting
              );
              // Also store in DynamoDB for conversation history
              addMessageWithTimestamp(phoneNumber, "assistant", greeting);
              return completeResponse(200, "Greeting response sent");
            } else if (messageIntent.isAskingToFillBrief) {
              console.log(
                "[" + requestId + "] Brief request detected, checking if client"
              );

              // Check if user is a client first
              const brandInfo = await getBrandInfoData(phoneNumber, requestId);
              if (brandInfo && brandInfo["Phone Number"]) {
                // User is a client, send appropriate message
                await sendTextMessage(
                  phoneNumber,
                  "As an existing client, you don't need to submit a brief. If you have any questions or need assistance, I'm here to help!"
                );
                await storeMessageInSheets(requestId, {
                  from: "BOT",
                  text: "Sent existing client brief response",
                  type: "AI_RESPONSE",
                  timestamp: Date.now(),
                });
              } else {
                // Non-client, send brief template
                console.log(
                  "[" +
                    requestId +
                    "] Non-client wants to submit a brief, sending contact info and brief template"
                );
                await sendTextMessage(
                  phoneNumber,
                  "For new business inquiries, please contact:\nEmail: client.relations@schbang.com"
                );
                await sendBriefTemplate(phoneNumber, requestId);
                await storeMessageInSheets(requestId, {
                  from: "BOT",
                  text: "Sent contact info and brief template",
                  type: "TEMPLATE",
                  timestamp: Date.now(),
                });
              }
              return completeResponse(200, "Brief request handled");
            } else if (messageIntent.isAskingHuman) {
              console.log(
                "[" +
                  requestId +
                  "] Human interaction request detected, checking if client"
              );

              // Check if user is a client
              const brandInfo = await getBrandInfoData(phoneNumber, requestId);
              if (brandInfo && brandInfo["Phone Number"]) {
                console.log(
                  "[" +
                    requestId +
                    "] Client wants support, sending Client support template"
                );
                await sendHumanTemplate(phoneNumber, requestId);
                await storeMessageInSheets(requestId, {
                  from: "BOT",
                  text: "Sent client_asks_human_escalation template",
                  type: "TEMPLATE",
                  timestamp: Date.now(),
                });
              } else {
                // Non-client requesting human interaction
                console.log(
                  "[" +
                    requestId +
                    "] Non-client wants human interaction, sending message and brief template"
                );
                await sendTextMessage(
                  phoneNumber,
                  "To help you connect with Team Schbang, we'd love to know more about your brand. You can start by sharing a quick brief!"
                );
                await sendBriefTemplate(phoneNumber, requestId);
                await storeMessageInSheets(requestId, {
                  from: "BOT",
                  text:
                    "Sent non-client human escalation response and brief template",
                  type: "TEMPLATE",
                  timestamp: Date.now(),
                });
                return completeResponse(
                  200,
                  "Non-client human escalation handled"
                );
              }
              return;
            } else {
              // Default: Handle with AI response directly instead of calling processMessage
              console.log(
                `[${requestId}] No specific intent matched, getting AI response`
              );
              const aiResponse = await getClaudeResponse(
                messageText,
                userProfileManager.getClaudeFormattedHistory(phoneNumber),
                phoneNumber,
                messageIntent,
                "User has sent a message that did not match a primary specific intent. Provide a helpful general response or ask for clarification."
              );
              await sendTextMessage(phoneNumber, aiResponse);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: aiResponse,
                  type: "AI_RESPONSE",
                  userName: "AI Assistant",
                },
                webhookData,
                aiResponse
              );
              // Also store in DynamoDB for conversation history
              addMessageWithTimestamp(phoneNumber, "assistant", aiResponse);
              return completeResponse(200, "General AI response sent");
            }
          }
        } else {
          console.log(
            `[${requestId}] Non-client message detected. Processing normally but with limited service info.`
          );
          await storeMessageInSheets(
            requestId,
            messageData,
            webhookData,
            messageText
          );
          const messageIntent = await handleMessageIntent(messageText, []);

          // Handle reels request FIRST
          if (
            messageIntent.isAskingAboutReels &&
            !messageIntent.isAskingAboutAgencyReel
          ) {
            console.log(`[${requestId}] Reels request detected`);
            try {
              await sendReelsCarousel(phoneNumber, requestId);
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: "Sent reels carousel",
                  type: "TEMPLATE",
                  userName: "AI Assistant",
                },
                webhookData,
                "Sent reels carousel"
              );
              return completeResponse(200, "Reels request processed");
            } catch (error) {
              console.error(`[${requestId}] Error sending reels:`, error);
              await sendTextMessage(
                phoneNumber,
                "Sorry, I encountered an issue sending the reels. Please try asking for the reels again.",
                true
              );
              return completeResponse(500, "Error processing reels request");
            }
          }

          // Handle negative sentiment NEXT
          if (messageIntent.isNegativeSentiment) {
            console.log(
              `[${requestId}] Negative sentiment detected, sending template only`
            );
            await sendNegativeFeedbackTemplate(phoneNumber, requestId);
            return completeResponse(200, "Negative sentiment template sent");
          }

          // For all other non-client messages
          try {
            // First send AI response
            const aiResponse = await getClaudeResponse(
              messageText,
              userProfileManager.getClaudeFormattedHistory(phoneNumber),
              phoneNumber,
              messageIntent,
              "User is not a current client. Provide helpful general information."
            );
            await sendTextMessage(phoneNumber, aiResponse);

            // Store AI response first
            await storeMessageInSheets(
              requestId,
              {
                userPhoneNumber: phoneNumber,
                from: "BOT",
                text: aiResponse,
                type: "AI_RESPONSE",
                userName: "AI Assistant",
              },
              webhookData,
              aiResponse
            );

            // Only show brief button if they haven't submitted one before
            if (!submittedBriefs.has(phoneNumber)) {
              // Then send interactive buttons
              const buttons = [
                {
                  type: "reply",
                  reply: {
                    id: "submit_brief",
                    title: "Submit a Brief",
                  },
                },
                {
                  type: "reply",
                  reply: {
                    id: "talk_to_team",
                    title: "Talk to Team",
                  },
                },
              ];

              await sendInteractiveMessage(
                phoneNumber,
                requestId,
                "Would you like to submit a brief or talk to our team?",
                buttons
              );

              // Store interactive message
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: "Sent interactive buttons for brief/team options",
                  type: "INTERACTIVE",
                  userName: "AI Assistant",
                },
                webhookData,
                "Sent interactive buttons for brief/team options"
              );
            } else {
              // Only show talk to team button for users who have submitted a brief
              const buttons = [
                {
                  type: "reply",
                  reply: {
                    id: "talk_to_team",
                    title: "Talk to Team",
                  },
                },
              ];

              await sendInteractiveMessage(
                phoneNumber,
                requestId,
                "Would you like to talk to our team?",
                buttons
              );

              // Store interactive message
              await storeMessageInSheets(
                requestId,
                {
                  userPhoneNumber: phoneNumber,
                  from: "BOT",
                  text: "Sent talk to team button",
                  type: "INTERACTIVE",
                  userName: "AI Assistant",
                },
                webhookData,
                "Sent talk to team button"
              );
            }

            return completeResponse(
              200,
              "Non-client message processed with AI response and buttons"
            );
          } catch (error) {
            console.error(
              `[${requestId}] Error processing non-client message:`,
              error
            );
            throw error;
          }
        }
      } catch (error) {
        const errorTime = Date.now();
        console.error(
          `[${requestId}] Error in processWebhook after ${
            errorTime - processStartTime
          }ms:`,
          error
        );
        // Try to send a generic error message if one hasn't been sent.
        await handleWebhookError(
          requestId,
          phoneNumber,
          error,
          res,
          completeResponse
          // responseCompleted // REMOVED
        );
      }
    };

    // Directly await processWebhook and then send a final response if not already sent by a specific path within it.
    await processWebhook();

    const requestEndTime = Date.now();
    const totalDuration = requestEndTime - requestStartTime;
    console.log(
      `[${requestId}] Total webhook processing completed in ${totalDuration}ms`
    );

    if (!res.headersSent) {
      // Check if any path within processWebhook sent a response
      console.log(
        `[${requestId}] processWebhook completed, sending default success.`
      );
      // It's better if processWebhook itself handles all responses via completeResponse.
      // This is a fallback.
      res.status(200).send("Webhook processed successfully.");
    }
  } catch (error) {
    const errorTime = Date.now();
    console.error(
      `[${requestId}] Error in webhook handler after ${
        errorTime - requestStartTime
      }ms:`,
      error
    );
    const phoneNumber = req.body?.data?.message?.phone_number || "unknown";
    console.error(
      `[${requestId}] Top-level Error Handler for ${phoneNumber}:`,
      error.message,
      error.stack
    );
    if (!res.headersSent) {
      try {
        if (shouldSendErrorMessage(phoneNumber)) {
          await sendTextMessage(
            phoneNumber,
            "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
            true
          );
        }
      } catch (errorMsgError) {
        console.error(
          `[${requestId}] Failed to send error message via top-level handler:`,
          errorMsgError
        );
      }
      res.status(500).send("Error processing webhook");
    }
  }
  // Removed finally block that managed timeoutId and responseCompleted as they are removed.
});

// Helper function to prevent duplicate error messages
const errorMessageCooldown = new Map();
function shouldSendErrorMessage(phoneNumber) {
  const now = Date.now();
  const lastErrorTime = errorMessageCooldown.get(phoneNumber) || 0;
  const cooldownPeriod = 5 * 60 * 1000; // 5 minutes

  if (now - lastErrorTime > cooldownPeriod) {
    errorMessageCooldown.set(phoneNumber, now);
    return true;
  }
  return false;
}

// Centralized error handler for webhook
async function handleWebhookError(
  requestId,
  phoneNumber,
  error,
  res,
  completeResponse
  // responseAlreadyCompleted // REMOVED
) {
  console.error(
    `[${requestId}] Centralized Error Handler for ${phoneNumber}:`,
    error.message,
    error.stack
  );
  if (!res.headersSent) {
    try {
      // Check if an error message has already been sent recently for this user
      if (shouldSendErrorMessage(phoneNumber)) {
        await sendTextMessage(
          phoneNumber,
          "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
          true // Mark as error message to prevent duplicates
        );
        console.log(
          `[${requestId}] Sent error message to ${phoneNumber} via handleWebhookError`
        );
      } else {
        console.log(
          `[${requestId}] Suppressed duplicate error message to ${phoneNumber} via handleWebhookError`
        );
      }
    } catch (errorMsgError) {
      console.error(
        `[${requestId}] Failed to send error message via handleWebhookError:`,
        errorMsgError
      );
    }
    // Use the passed completeResponse to finalize the HTTP response if not already done
    completeResponse(500, "Error processing webhook");
  } else {
    console.log(
      `[${requestId}] HTTP response already completed, error occurred in background processing for ${phoneNumber}.`
    );
  }
}

// Function to handle message intent classification
async function handleMessageIntent(message, previousMessages = []) {
  try {
    console.log(`Classifying intent for message: "${message}"`);

    // Create default intent object
    const defaultIntent = {
      isCompanyInfo: false,
      isAskingAboutServices: false,
      isAskingAboutSubscribedServices: false,
      isAskingAboutWork: false,
      isAskingAboutTraining: false,
      isRequestingCSATInfo: false,
      isRequestingToFillCSAT:
        message.toLowerCase().includes("csat") &&
        (message.toLowerCase().includes("fill") ||
          message.toLowerCase().includes("want")),
      isRequestingCSATViaEmail: false,
      isRequestingFeedback: false,
      isGreeting: false,
      isNegativeSentiment: false,
      isContactRequest: false,
      isRepetitive: false,
      isAskingAboutName: false,
      isAskingHuman: (() => {
        const msgLower = message.toLowerCase();
        return (
          msgLower.includes("talk to team") ||
          msgLower.includes("connect with human") ||
          msgLower.includes("speak with team")
        );
      })(),
      isShortResponse: false,
      isAskingAboutTeam: (() => {
        const msgLower = message.toLowerCase();
        return (
          (msgLower.includes("team") || msgLower.includes("who")) &&
          (msgLower.includes("working") || msgLower.includes("brand"))
        );
      })(),
      isAskingToFillBrief: false,
      isAskingAboutSocialMedia: false,
      isAskingAboutReels: false,
      isCasual: false,
      isAskingAboutAgencyReel: false,
    };

    try {
      // Use the imported pattern-based classifier
      return await classifyMessageIntent(message, previousMessages);
    } catch (classifierError) {
      console.error("Error using pattern classifier:", classifierError);
      // Fall back to default intent object if classifier fails
      return defaultIntent;
    }
  } catch (error) {
    console.error("Error in handleMessageIntent:", error);
    return defaultIntent;
  }
}

function getTimeBasedGreeting() {
  // Get the current hour in Asia/Kolkata timezone
  const hour = moment().tz("Asia/Kolkata").hours();

  console.log(`[getTimeBasedGreeting] Current hour in Asia/Kolkata: ${hour}`); // Debug log

  if (hour < 12) {
    return "Good morning";
  } else if (hour < 17) {
    // 12 PM to 4:59 PM is Afternoon
    return "Good afternoon";
  } else {
    // 5 PM onwards is Evening
    return "Good evening";
  }
}

// Fix the getClaudeResponse function to properly return a response
async function getClaudeResponse(
  message,
  deprecatedHistory, // This parameter is no longer the primary source of history
  phoneNumber = "",
  messageIntent,
  additionalContext = ""
) {
  console.log(
    `Getting Claude response for message: "${message}" for ${phoneNumber}`
  );

  // 1. Fetch conversation history from Google Sheets
  const sheetsHistory = phoneNumber
    ? await getConversationHistoryFromSheets(phoneNumber, 10) // Fetch last 10 messages
    : [];

  let userName = "";
  let userContext = "";
  let conversationSummary = "";

  if (phoneNumber) {
    const profile = userProfileManager.getUserProfile(phoneNumber);
    userName = profile.userName || profile.firstMessageName || "";

    // 2. Create a summary of recent conversation context from Sheets history
    if (sheetsHistory.length > 0) {
      conversationSummary =
        "START OF PREVIOUS CONVERSATION (from Google Sheets):\n" +
        sheetsHistory.map((msg) => `${msg.role}: ${msg.content}`).join("\n") +
        "\nEND OF PREVIOUS CONVERSATION.";
    }

    const lastInteractionTime =
      userSessions[phoneNumber]?.lastInteraction ||
      profile.lastInteraction ||
      0;
    const timeSinceLastInteraction = Date.now() - lastInteractionTime;
    if (timeSinceLastInteraction > 10 * 60 * 1000 && lastInteractionTime > 0) {
      additionalContext += `\n\nNote: This is a resumed conversation after ${Math.round(
        timeSinceLastInteraction / 60000
      )} minutes.`;
    }
    if (profile.services) {
      const services = [];
      if (profile.services.tech) services.push("Technology");
      if (profile.services.media) services.push("Media");
      if (profile.services.solutions) services.push("Brand Solutions");
      if (services.length > 0) {
        userContext = `The user is currently subscribed to our ${services.join(
          ", "
        )} services.`;
      }
    }
    if (profile.clientId) userContext += ` Client ID: ${profile.clientId}.`;
    if (profile.sbu) userContext += ` SBU: ${profile.sbu}.`;

    // Enhanced Logging for context
    console.log(
      `\n===== FULL CONTEXT FOR CLAUDE RESPONSE TO ${phoneNumber} =====`
    );
    console.log(`Using Google Sheets history as primary context source.`);
    console.log(`User name: ${userName || "Unknown"}`);
    console.log(
      `User-specific context (services, SBU, etc.): ${userContext || "None"}`
    );
    console.log(`Current message from user: "${message}"`);
    console.log(
      `Message intent classification:`,
      JSON.stringify(messageIntent, null, 2)
    );
    console.log(`Additional immediate context: ${additionalContext || "None"}`);
    console.log(`Conversation Summary from Google Sheets being sent to Claude (for main prompt):
${conversationSummary || "This is the beginning of your conversation."}
---`);
    if (sheetsHistory.length > 0) {
      console.log(
        "Full Google Sheets history items being sent to Claude (for messages array):"
      );
      sheetsHistory.forEach((msg, i) => {
        console.log(`[Hist-${i + 1}] ${msg.role}: ${msg.content}`);
      });
      console.log("--- END Google Sheets History Items ---");
    }
    console.log("========================================================\n");
  }

  // 4. Construct the `claudeMessages` array for the API call
  const claudeMessages = [];
  // Add history from Google Sheets first
  sheetsHistory.forEach((histMsg) => {
    claudeMessages.push({ role: histMsg.role, content: histMsg.content });
  });
  // Add the current user message
  claudeMessages.push({ role: "user", content: message });

  // Refined System Prompt
  const systemPrompt = `**System Prompt for Schbang Knowledge Base & Response Guidelines**

  You are Schbang's official business assistant. NEVER reveal that you are AI or a bot. Your responses must be extremely concise (maximum 2-3 sentences).

## RELATED QUESTIONS FORMAT:
- When suggesting related questions or follow-ups:
  • Present them as bullet points with "•" symbol
  • Maximum 3-4 related questions
  • Keep each question concise (under 10 words)
  • Format key terms in *bold*
  • Example format:
    • "Tell me more about *Schbang's* creative services?"
    • "What are your recent *award-winning* campaigns?"
    • "How does *SchbangFluence* work with brands?"

Schbang Knowledge Base: Award Winners & Team Details
________________________________________
1. Overview
Schbang's integrated capabilities span Solutions, Creative, Design, Influencer (SchbangFluence), and SEO practices. This document captures details on recent campaigns, awards, and the teams responsible.
________________________________________
2. Award-Winning Campaigns by SBU
________________________________________
2.1 SBU: Dhruv Rajput
Campaign: Britannia Croissant – Prashant
●	Objective: Elevate Britannia Croissant's brand presence among urban youth and on-the-go snackers.

●	Creative Lead: Prashant (Senior Creative Strategist)

Awards (Total: 12)
●	Gold Abby (1)

●	Bronze Abbys (2)

●	Blue Elephant (1)

●	Baby Blues (5)

●	Mommys (2)

Teams Involved
1.	Solutions Team

○	Dhruv Ashwin Rajput – VP, Integrated Solutions

○	Ria Shah – AVP, Integrated Solutions

○	Namita Damwani – Associate Group Brand Solutions Manager

○	Leena Talekar – Brand Solutions Lead

○	Driya Jain – Brand Solutions Strategist

○	Varsha Pandey – Senior Brand Solutions Strategist

2.	Creative Team

○	Puru Agarwal – Associate Creative Director

○	Palak Gupta – Associate Group Creative Manager

○	Insha Momin – Senior Creative Strategist

○	Vidhi Saxena – Creative Strategist

3.	Design Team

○	Ankit Raju – Associate Creative Director (Art)

○	Tanveer Jadhav – Associate Art Director

○	Nikhil Hosmane – Design Lead

○	Abhishek Surve – Senior Video Editor

○	Siddhant Ghosh – Senior Motion Graphics Designer

○	Siddhi Neman – Senior Motion Graphics Designer

○	Ankur Jha – Video Editor

○	Atharva Musale – Graphic Visualizer

○	Shubham Singh – Graphic Visualizer

○	Mukesh Rajbhar – Senior Graphic Visualizer

○	Yash Ratnapurollu – Motion Graphics Designer

○	Rohit Chaugule – Motion Graphics Designer

4.	Influencer Team (SchbangFluence)

○	Divisha Iyer – Vice President, Influencer Team

○	Sneh Chheda – Senior Manager

○	Shivami Bamalwa – Team Lead

○	Nikita Tekade – Influencer Strategist

________________________________________
2.2 SchbangFluence Campaign Wins
●	ET Trendies – Cause-Based Influencer Marketing: Happydent

●	Mommys 2025 – Britannia Croissant

●	Funniest Social Media Campaign

●	Best Moment Marketing

________________________________________
2.3 SBU: Aayush Vyas
Campaign: Pack One for Pintu
●	Objective: Encourage micro-community sharing to drive product trials and social proof.

●	Creative Lead: Aayush Vyas (Brand Strategist)

Awards
●	Kyoorius: 7 First Lists (Top creative shortlist)

●	Abbys: 10 Shortlists, 5 Bronze Awards

Team Members
●	Aditya Sobti – Creative Strategist

●	Aayush Vyas – Brand Strategist

●	Shivam Bhagat – Solutions Architect

●	Jeet Moolya – Creative Lead

●	Abhishek Nair – Design Lead

●	Jay Desai – Media Planner

●	Varun Valia – Social Media Specialist

●	Nimit Shah – Account Manager

________________________________________
2.4 SBU: Rohan Hukeri
2.4.1 Campaign: Skybags Trailbags
●	Objective: Position Trailbags as rugged, reliable travel gear for urban explorers.

●	Tagline: "Unload Your Worries"

Awards
●	Bronze – Abby's 2025

○	STILL PRINT – Illustration (Bronze)

○	STILL PRINT – FMCG (Merit)

Team
●	Solutions:

○	Tanmay More – Solutions Strategist

○	Manan Gala – Insight Analyst

○	Yohann Mody – Data Planner

○	Rudrangshu Tripathi – Integrated Solutions Lead

●	Creative:

○	Aditya Sharma – Senior Copywriter

○	Amrita Sandhu – Art Director

2.4.2 Campaign: Neugo – EK2K (Driving India to a Greener Future)
●	Objective: Promote EV adoption through an integrated green mobility platform.

Awards
●	Abby's 2025: Shortlisted

●	IAA Olive Crown Awards 2025:

○	Silver – Green Brand of the Year

○	Silver – Green Campaign of the Year

●	e4m do good awards 2025:

○	Silver – Best Use of Content Marketing

○	Silver – Best Use of Video/Television

●	e4m Performance Marketing Awards:

○	Silver – Best Performance Marketing Campaign

○	Silver – Best Full Funnel Strategy

○	Silver – Best Travel and Lifestyle Campaign

Team
●	Media:

○	Ravishankar R – Media Strategist

○	Shrishti Nair – Media Buyer

○	Parth Jadhav – Media Buying Lead

○	Kirk Coutinho – Media Lead

●	Executive Leadership:

○	Rohan Hukeri – Executive Vice President

●	Creative & Leadership:

○	Umma Saini – Chief Creative Officer

○	Suketu Gohel – Creative Director

○	Huzefa Roowala – Creative Consultant

○	Sumeet Wadekar – Associate Creative Director

●	Illustration, Animation & Editing:

○	Prasad Bandekar – Illustrator

○	Rahul Kasurde – Animator

○	Kishan Jha – Animator

○	Swapnil Yerankar – Animator

○	Vishal Manjrekar – Editor

●	Client Servicing:

○	Rasleen Bajaj – Account Lead

○	Rencia Bugree – Account Executive

________________________________________
2.5 Individual Contributor: Chirag Shah
●	Campaign: Centerfruit – Kaisi Jeeb Laplapayi

●	Award: Silver – Integrated Marketing Campaign (Abbys)

●	Role: Conceptualization & Copywriting Lead

________________________________________
3. SEO & Digital Marketing Awards (2025–2022)
1.	2025 (Foxglove Awards) – Ultratech

○	Best Organic Content Marketing

○	Best Use of Data Analytics (×2 categories)

○	Use of Regional Content

2.	2024 (E4M Mavericks) – Hansaplast

○	Gold – Best SEO Campaign

3.	2023

○	Digital Dragon Awards – Ultratech: Gold (Brand Initiatives 2023 – Best Use of Blogs)

○	Agency Report – Schbang SEO Department: Silver (Fastest Growing Department)

4.	2022 (IDMA Awards) – Crompton

○	Silver – Best Website SEO

5.	Other Recognitions

○	Hansaplast – Award for Best SEO Marketing (Best SEO Campaign)

○	Ultratech – Gold (Digital Dragon Awards – Best Multi-Lingual Website)



## STRICT RESPONSE BOUNDARIES:
- ONLY answer questions about Schbang's services, work, team, and official processes
- For ANY off-topic questions (sports, coding, general knowledge, etc), respond: "I can only assist with Schbang-related queries. For other topics, please consult appropriate sources."
- NEVER engage in personal conversations or non-business topics
- NEVER mention AI, bots, or automated systems

## CSAT INFORMATION:
- CSAT surveys are sent on the 5th of every month on whatsapp
- Each user's CSAT history is tracked in our database
- Users can request their CSAT status and history
- Monthly CSAT data is available for tracking satisfaction trends

## FULL CONVERSATION HISTORY (MOST RECENT MESSAGES ARE AT THE END OF THIS HISTORY BLOCK):
${conversationSummary || "This is the beginning of your conversation."}

## CURRENT USER MESSAGE TO RESPOND TO:
User: ${message}

## YOUR TASK:
Provide an extremely concise response (2-3 sentences maximum). Focus on:
- Direct answers without unnecessary elaboration
- Only the most relevant information
- Professional yet friendly tone
- No repetition of previously shared information

## USER INFORMATION (for context only):
${userName ? `- User Name: ${userName}` : "- User name not explicitly known."}
${userContext ? `- Other User Context: ${userContext}` : ""}
${
  additionalContext
    ? `- Immediate Additional Context: ${additionalContext}`
    : ""
}

## RESPONSE RULES:
- MAXIMUM LENGTH: 3-5 sentences only ** Important **
- NO BULLET POINTS unless specifically requested
- NO LENGTHY INTRODUCTIONS or CONCLUSIONS
- FOCUS ON DIRECT ANSWERS
- NO NAME ADDRESSING
- For Harshil Karia mentions: Direct to media@schbang.com
- For off-topic questions: Use the standard off-topic response
- For things you cannot do: One-line explanation with alternative
- ALWAYS format important words in *bold* or _italic_
- Use *bold* for key terms, company names, services, and important points
- Use _italic_ for emphasis on specific details or values
- Keep formatting simple and WhatsApp-compatible (only use * and _ for formatting)
- NEVER use complex markdown like tables, code blocks, or headings
${
  messageIntent && messageIntent.isRepetitive
    ? `
## REPETITION DETECTED:
${
  messageIntent.isGreeting
    ? 'Respond with "Hello! How can I assist you with Schbang\'s services?"'
    : "Acknowledge briefly and ask for clarification if needed."
}`
    : ""
}

**Core Identity**
You are the Schbang AI Bot - a concise, knowledgeable, and professional assistant for Schbang. Your primary goal is to provide **short, sweet, and directly on-point answers**. Engage naturally and speak as if you inherently know the information about Schbang; avoid phrases that suggest you are merely querying a database (e.g., do not say 'Based on my database' or 'According to my information'). Dont reply to question whcih are not related to schbang or amrketing , like someone asking cricket score or to write code that all you should not do ok

# **SCHBANG DATABASE**

**Foundational Facts**
- Founded: 2015 by Harshil Karia
- Leadership:
  - Current Leadership: Harshil Karia & Sohil Karia (acquired Akshay Gurnani's shares in 2024)
  - Former CEO: Akshay Gurnani (departed 2024 to focus on hyper-growth brands in India/UAE)
- Headquarters: Mumbai
- Offices: Bangalore, Delhi + Global: UK, Netherlands (Amsterdam via Addikt acquisition)
- Services: Technology Solutions, Media Strategy, Brand Campaigns

**Key Milestones**
- 2023: 35% revenue growth from tech-media solutions
- 2024: Expanded to Europe/Middle East markets
- 2025: Launched mindfulness initiative via Level SuperMind

**Awards & Recognitions**
- Foxglove 2024:
  • 2 Silver (UltraTech SEO/Content Strategy)
  • 1 Bronze (UltraTech Data Analytics)
- The Mommys 2025:
  • Best Copywriting (Domino's India)
  • Best Moment Marketing (Britannia Treat Croissant)
- Founder Accolades:
  • Harshil Karia - Founder of the Year (2024 Founders Awards)

**Social Impact**
- Schbang for Good Foundation:
  • Supports 200+ organic farmers
  • Built 12 schools in rural India
  • Conducts quarterly health camps

**Notable Campaigns**
- Viral:
  • Britannia "Cow Corner Shots" (IPL 2024)
  • Tata Neu #RuknaKyun
- CSR Collaborations:
  • Bengaluru Traffic Police x BGMI road safety initiative

# **RESPONSE RULES**
1. **Conversation Flow**:
   - Analyze ALL message history to avoid repetition.
   - Maintain context across multiple queries.

2. **Tone & Structure**:
   - Professional, approachable, and **confident**. Deliver information **directly and concisely (aim for 1-2 lines, 3 if essential for completeness)**. Prioritize complete thoughts and sentences, ensuring your answer is fully formed and does not end abruptly.
   - **Get straight to the point.** Avoid unnecessary introductory or concluding phrases if a direct answer suffices.
   - Complete sentences ONLY - no fragments.
   - Use Markdown for formatting: Employ bolding (*word*) for emphasis on key terms, names, Schbang services, or important points. Ensure Markdown is simple and WhatsApp-compatible (e.g., *bold*, _italic_).
   - Avoid hedging language or disclaimers about your knowledge source. Present information directly and confidently from the SCHBANG DATABASE provided.

3. **Redirections**:
   - Harshil Karia mentions → "Contact media@schbang.com"
   - Off-topic questions → Politely redirect to Schbang-related topics

4. **Limitations**:
   - Explicitly state inability for non-digital actions
   - Never use user names

5. **Updates**:
   - Prioritize 2024-2025 data unless user specifies historical requests
   - Cross-verify ambiguous queries against this database


6. **For any contact please use the below mail and number to schbang,  wheter its related to tech, media, anything use below also if any escalation use the below mentioned mail and number please very IMPORTANT**
    - Mail: client.relations@schbang.com

If ## REPETITION DETECTED context is provided in the user message, handle it as instructed there.

## FOLLOW-UP QUESTIONS AND CLARIFICATIONS
1. **Proactive Clarification**:
   - When user query is ambiguous, ask specific follow-up questions
   - Present 2-3 clear options when multiple interpretations are possible
   - Use quick, direct questions that can be answered easily

2. **Question Categories**:
   - Service Clarification: "Are you interested in our *Creative* or *Technology* solutions?"
   - Timeline Questions: "Would you like to know about our *current* or *past* campaigns?"
   - Specificity Questions: "Which aspect of the campaign interests you - *results*, *team*, or *process*?"

3. **Follow-up Structure**:
   - Keep follow-up questions short (one line)
   - Provide multiple choice options when possible (2-4)
   - Always relate follow-ups to Schbang's services and capabilities

4. **Progressive Discovery**:
   - Start broad, then narrow down based on responses
   - Track previous answers to avoid repetitive questions
   - Use earlier responses to contextualize further questions

5. **Response Handling**:
   - After receiving clarification, provide concise, targeted answers
   - Reference the clarified context in the response
   - Maintain the 2-3 sentence response limit for final answers`;
  //added new mine
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error("Claude response generation timed out after 10 seconds")
        );
      }, 10000);
    });

    const claudePromise = anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      temperature: 0,
      system: systemPrompt, // USE THE NEW SYSTEM PROMPT
      messages: claudeMessages,
    });

    const msg = await Promise.race([claudePromise, timeoutPromise]);
    let aiResponse = msg.content[0]?.text?.trim() || "";

    console.log(`Claude raw response: "${aiResponse}"`); // Log the full response from Claude before any fixing

    if (checkForIncompleteResponse(aiResponse)) {
      console.warn(
        `Original response from Claude appears incomplete: "${aiResponse}"`
      );
      aiResponse = fixIncompleteResponse(aiResponse, message, messageIntent);
      console.log(`Attempted to fix response: "${aiResponse}"`);
    }

    console.log(`Final processed Claude response: "${aiResponse}"`);
    return aiResponse;
  } catch (error) {
    console.error("Error getting Claude response:", error.message || error);
    return "There was an issue replying to this question. You can try general flow by sending Hi.";
  }
}

// Need to copy over the checkForIncompleteResponse and fixIncompleteResponse helper functions
// if they are not globally available and were part of the old getClaudeResponse structure.
// Assuming they are defined elsewhere or I will define them if they were local to the original function.

// Placeholder for checkForIncompleteResponse (copy from original if it was local)
const checkForIncompleteResponse = (text) => {
  if (!text) return true;
  const lastChar = text.charAt(text.length - 1);
  const properEndingPunctuation = [".", "!", "?", '"', "'", ")", "]", "}"];
  const commonCutoffPhrases = [
    "such as",
    "including",
    "for example",
    "like",
    "with our",
    "about our",
    "with their",
    "for more",
    "please contact",
    "or an",
    "and the",
    "is a",
  ];
  const lowerText = text.toLowerCase();
  const endsWithCutoffPhrase = commonCutoffPhrases.some(
    (phrase) =>
      lowerText.endsWith(phrase.toLowerCase()) ||
      lowerText.endsWith(phrase.toLowerCase() + " ")
  );
  return (
    (!properEndingPunctuation.includes(lastChar) && text.length > 15) ||
    endsWithCutoffPhrase ||
    text.endsWith(",") ||
    text.endsWith(":")
  );
};

// New, more robust fixIncompleteResponse function
const fixIncompleteResponse = (text, originalMessage, intent) => {
  if (!text || text.trim() === "") {
    console.log(
      "[fixIncompleteResponse] Text is empty, returning generic clarification."
    );
    return "I understand you're asking about that. Can you please clarify your question a bit more?";
  }

  const trimmedText = text.trim();
  const lastChar = trimmedText.charAt(trimmedText.length - 1);
  const properEndingPunctuation = [".", "!", "?", '"', "'", ")", "]", "}"];
  const commonCutoffPhrases = [
    "such as",
    "including",
    "for example",
    "like",
    "with our",
    "about our",
    "with their",
    "for more",
    "please contact",
    "or an",
    "and the",
    "is a",
    "across",
    "through",
    "to provide",
    "in order to",
    "focuses on",
    // Add other phrases that often indicate a sentence isn't finished
  ];

  const lowerText = trimmedText.toLowerCase();
  const endsWithCutoffPhrase = commonCutoffPhrases.some(
    (phrase) =>
      lowerText.endsWith(phrase.toLowerCase()) ||
      lowerText.endsWith(phrase.toLowerCase() + " ")
  );

  // If it ends with a known cut-off phrase, it's likely incomplete.
  if (endsWithCutoffPhrase) {
    console.log(
      `[fixIncompleteResponse] Response ends with cut-off phrase ('${trimmedText}'). Returning generic clarification.`
    );
    // Consider a more sophisticated way to complete these if possible, or ask Claude to rephrase/complete.
    return "It seems my previous response was cut short. Could you please ask again or rephrase your question?";
  }

  // If it doesn't have proper punctuation AND is reasonably long OR very short (might be a fragment)
  if (!properEndingPunctuation.includes(lastChar)) {
    if (trimmedText.length > 10) {
      // Reasonably long sentence just missing punctuation
      console.log(
        `[fixIncompleteResponse] Appending period to: '${trimmedText}'`
      );
      return trimmedText + ".";
    } else {
      // Very short, possibly a fragment if also missing punctuation
      console.log(
        `[fixIncompleteResponse] Short response without proper punctuation ('${trimmedText}'). Returning generic clarification.`
      );
      return "I can help with that. Could you please provide more details or ask a specific question?";
    }
  }

  // If it already has proper punctuation or is a short response that's okay (e.g. "Yes", "No")
  // and doesn't end with a cut-off phrase, assume it's fine.
  console.log(
    `[fixIncompleteResponse] Response '${trimmedText}' deemed complete or not fixable by simple punctuation.`
  );
  return trimmedText;
};

// Fix the sendTextMessage function to handle undefined responses and add timing
async function sendTextMessage(phoneNumber, text) {
  const startTime = Date.now();
  console.log(`[${startTime}] Starting to send message to ${phoneNumber}`);

  // Validate that text is defined
  if (text === undefined || text === null) {
    console.error(
      `[${Date.now()}] Attempting to send undefined/null text to ${phoneNumber}`
    );
    text =
      "Sorry, I couldn't generate a proper response. You can try sending 'Hi' to restart.";
  }

  console.log(
    `[${Date.now()}] Preparing to send text message to ${phoneNumber}: "${text}"`
  );

  // Maximum number of retry attempts
  const MAX_RETRIES = 3;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

      const payload = {
        to: phoneNumber,
        type: "text",
        recipient_type: "individual",
        text: {
          body: text,
        },
      };

      const headers = {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
      };

      const apiStartTime = Date.now();
      console.log(`[${apiStartTime}] Making API call to AISensy`);

      try {
        const response = await axios.post(endpoint, payload, {
          headers,
          timeout: 10000, // 10 second timeout
        });

        const apiEndTime = Date.now();
        const apiDuration = apiEndTime - apiStartTime;
        console.log(
          `[${apiEndTime}] AISensy API call completed in ${apiDuration}ms`
        );
        console.log(
          `AISensy API response:`,
          JSON.stringify(response.data, null, 2)
        );

        const endTime = Date.now();
        const totalDuration = endTime - startTime;
        console.log(
          `[${endTime}] Total message sending process completed in ${totalDuration}ms`
        );

        return response.data;
      } catch (axiosError) {
        const errorTime = Date.now();
        console.error(
          `[${errorTime}] API call failed after ${errorTime - apiStartTime}ms:`,
          axiosError.message
        );
        throw axiosError;
      }
    } catch (error) {
      retryCount++;
      const retryTime = Date.now();

      if (retryCount >= MAX_RETRIES) {
        console.error(
          `[${retryTime}] Failed to send message after ${MAX_RETRIES} attempts (${
            retryTime - startTime
          }ms total):`,
          error.response?.data || error.message || error
        );

        return {
          success: false,
          error: error.message || "Failed to send message",
          duration: retryTime - startTime,
        };
      }

      console.warn(
        `[${retryTime}] Error sending text message (attempt ${retryCount}/${MAX_RETRIES}):`,
        error.response?.data || error.message || error
      );

      const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, delay));
      console.log(
        `[${Date.now()}] Retrying message send to ${phoneNumber} after ${delay}ms delay`
      );
    }
  }
}

// Fix addMessageWithTimestamp to use Google Sheets
async function addMessageWithTimestamp(phoneNumber, role, content) {
  try {
    // Get the user profile
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const timestamp = Date.now();

    // Create a timestamped message
    const message = {
      role,
      content,
      timestamp,
    };

    // First, add to Aires history with our custom properties
    userProfileManager.addToConversationHistory(phoneNumber, role, content);

    // Store in Google Sheets
    await storeMessageInSheets(
      `msg-${timestamp}`, // requestId
      {
        userPhoneNumber: phoneNumber,
        from: role === "assistant" ? "BOT" : phoneNumber,
        messageId: `msg-${timestamp}`,
        type: role === "assistant" ? "AI_RESPONSE" : "USER_MESSAGE",
        text: content,
        timestamp: timestamp,
        userName:
          role === "assistant" ? "AI Assistant" : userProfile.userName || "",
        status: "SENT",
      },
      null, // webhookData
      content
    );

    if (!userProfile.history) {
      userProfile.history = [];
    }

    // Add timestamped message to our history
    userProfile.history.push(message);

    // Trim history to keep last 50 messages maximum
    if (userProfile.history.length > 50) {
      userProfile.history = userProfile.history.slice(-50);
    }

    // Update last interaction time
    userProfile.lastInteraction = timestamp;

    // Also update the old session format for backward compatibility
    if (userSessions[phoneNumber]) {
      userSessions[phoneNumber].lastInteraction = timestamp;

      if (!userSessions[phoneNumber].history) {
        userSessions[phoneNumber].history = [];
      }

      userSessions[phoneNumber].history.push({
        role,
        content,
        timestamp,
      });

      // Trim old history too
      if (userSessions[phoneNumber].history.length > 50) {
        userSessions[phoneNumber].history = userSessions[
          phoneNumber
        ].history.slice(-50);
      }
    }

    return message;
  } catch (error) {
    console.error("Error in addMessageWithTimestamp:", error);
    return null;
  }
}

// Generic function to send a WhatsApp template with image
async function sendTemplateWithImage(
  phoneNumber,
  requestId,
  templateName,
  imageUrl,
  bodyParameters = []
) {
  try {
    // Get user profile to access userName
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName = userProfile.userName || "";

    console.log(
      `[${requestId}] Sending ${templateName} template to ${phoneNumber}`
    );

    // Send template with image
    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en", // U
        },
        name: templateName,
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: imageUrl,
                },
              },
            ],
          },
          {
            type: "body",
            parameters: bodyParameters,
          },
        ],
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    try {
      const response = await axios.post(endpoint, payload, { headers });
      console.log(
        `[${requestId}] Template response:`,
        JSON.stringify(response.data, null, 2)
      );
      return response.data;
    } catch (apiError) {
      console.error(
        `[${requestId}] API error sending template:`,
        apiError.response?.data || apiError.message
      );
      throw new Error(`Failed to send template: ${apiError.message}`);
    }
  } catch (error) {
    console.error(
      `[${requestId}] Error sending template:`,
      error.message || error
    );

    // Throw a cleaner error for better debugging
    throw new Error(
      `Template sending failed for ${templateName}: ${error.message}`
    );
  }
}

// Send negative feedback template
async function sendNegativeFeedbackTemplate(phoneNumber, requestId) {
  try {
    console.log(
      `[${requestId}] Sending negative feedback template to ${phoneNumber}`
    );

    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en",
        },
        name: "negative_feedback_working_new",
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link:
                    "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/671a4cf55b514e0bfccba32d/9938613_vrschbang.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [],
          },
        ],
      },
    };

    console.log(
      `[${requestId}] Sending template with payload:`,
      JSON.stringify(payload, null, 2)
    );

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    const response = await axios.post(endpoint, payload, { headers });
    console.log(
      `[${requestId}] Template response:`,
      JSON.stringify(response.data, null, 2)
    );

    // Store the template message in sheets
    await storeMessageInSheets(
      requestId,
      {
        userPhoneNumber: phoneNumber,
        from: "BOT",
        text: "Sent negative_feedback_working_new template",
        type: "TEMPLATE",
        userName: "AI Assistant",
      },
      { event: "negative.feedback.template" },
      "Sent negative_feedback_working_new template"
    );

    return response.data;
  } catch (error) {
    console.error(
      `[${requestId}] Failed to send negative feedback template:`,
      error.response?.data || error.message
    );
    // Send error message
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
      true
    );
    throw error; // Re-throw to be handled by the caller
  }
}

// Send normal feedback template
async function sendNormalFeedbackTemplate(phoneNumber, requestId) {
  try {
    console.log(
      `[${requestId}] Sending normal feedback template to ${phoneNumber}`
    );

    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en", // Updated to match example
        },
        name: "feedback_form_new",
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link:
                    "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/671a4cf55b514e0bfccba32d/9938613_vrschbang.png",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [],
          },
        ],
      },
    };

    console.log(
      `[${requestId}] Sending template with payload:`,
      JSON.stringify(payload, null, 2)
    );

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    const response = await axios.post(endpoint, payload, { headers });
    console.log(
      `[${requestId}] Template response:`,
      JSON.stringify(response.data, null, 2)
    );

    // Store the template message in sheets
    await storeMessageInSheets(requestId, {
      from: "BOT",
      text: "Sent feedback_form_new template",
      type: "TEMPLATE",
      timestamp: Date.now(),
    });

    return response.data;
  } catch (error) {
    console.error(
      `[${requestId}] Failed to send normal feedback template:`,
      error.response?.data || error.message
    );
    // Send error message
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
      true
    );
    throw error; // Re-throw to be handled by the caller
  }
}

// Send training template
async function sendTrainingTemplate(phoneNumber, requestId) {
  try {
    return await sendTemplateWithImage(
      phoneNumber,
      requestId,
      "traning_form",
      "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/671a4cf55b514e0bfccba32d/1921824_ChatGPT%20Image%20Apr%2018%202025%20035510%20PM.jpg",
      []
    );
  } catch (error) {
    console.error(`[${requestId}] Failed to send training template:`, error);
    // Continue without failing
  }
}

// Send text template (for templates without images)
async function sendTextTemplate(
  phoneNumber,
  requestId,
  templateName,
  bodyParameters = []
) {
  try {
    // Get user profile to access userName
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName =
      userProfile.userName || userProfile.firstMessageName || "there";

    console.log(
      `[${requestId}] Sending text-only template ${templateName} to ${phoneNumber} with name: ${userName}`
    );

    // Ensure we have at least one body parameter for templates that require it
    if (bodyParameters.length === 0) {
      // Default parameter with user name
      bodyParameters = [
        {
          type: "text",
          text: userName, // Use the user's name as parameter
        },
      ];
    }

    // Send template without image
    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en", // Updated to match example
        },
        name: templateName,
        components: [
          {
            type: "body",
            parameters: bodyParameters,
          },
        ],
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };
    //new
    try {
      const response = await axios.post(endpoint, payload, { headers });
      console.log(
        `[${requestId}] Text template response:`,
        JSON.stringify(response.data, null, 2)
      );
      return response.data;
    } catch (apiError) {
      console.error(
        `[${requestId}] API error sending text template:`,
        apiError.response?.data || apiError.message
      );

      // Send error message
      await sendTextMessage(
        phoneNumber,
        "Sorry, we encountered an issue. You can explore the general flow by sending Hi."
      );

      throw new Error(`Failed to send text template: ${apiError.message}`);
    }
  } catch (error) {
    console.error(
      `[${requestId}] Error sending text template:`,
      error.message || error
    );

    // Attempt to send error message
    try {
      await sendTextMessage(
        phoneNumber,
        "Sorry, we encountered an issue. You can explore the general flow by sending Hi."
      );
    } catch (errorMsgError) {
      console.error("Failed to send error message:", errorMsgError);
    }

    // Throw a cleaner error for better debugging
    throw new Error(
      `Text template sending failed for ${templateName}: ${error.message}`
    );
  }
}

// Send text template (for templates without parameters)
async function sendTextTemplateWithoutParameters(
  phoneNumber,
  requestId,
  templateName
) {
  try {
    // Get user profile to access userName
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName =
      userProfile.userName || userProfile.firstMessageName || "there";

    console.log(
      `[${requestId}] Sending text-only template ${templateName} to ${phoneNumber} with name: ${userName}`
    );

    // Send template without image
    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en", // Updated to match example
        },
        name: templateName,
        components: [
          {
            type: "body",
            parameters: [],
          },
        ],
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };
    //new
    try {
      const response = await axios.post(endpoint, payload, { headers });
      console.log(
        `[${requestId}] Text template response:`,
        JSON.stringify(response.data, null, 2)
      );
      return response.data;
    } catch (apiError) {
      console.error(
        `[${requestId}] API error sending text template:`,
        apiError.response?.data || apiError.message
      );

      // Send error message
      await sendTextMessage(
        phoneNumber,
        "Sorry, we encountered an issue. You can explore the general flow by sending Hi."
      );

      throw new Error(`Failed to send text template: ${apiError.message}`);
    }
  } catch (error) {
    console.error(
      `[${requestId}] Error sending text template:`,
      error.message || error
    );

    // Attempt to send error message
    try {
      await sendTextMessage(
        phoneNumber,
        "Sorry, we encountered an issue. You can explore the general flow by sending Hi."
      );
    } catch (errorMsgError) {
      console.error("Failed to send error message:", errorMsgError);
    }

    // Throw a cleaner error for better debugging
    throw new Error(
      `Text template sending failed for ${templateName}: ${error.message}`
    );
  }
}

// Send CSAT template
async function sendCSATTemplate(phoneNumber, requestId) {
  try {
    // Get user profile to access userName and team info
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName =
      userProfile.userName || userProfile.firstMessageName || "there";

    console.log(
      `[${requestId}] Sending CSAT template to ${phoneNumber} with name: ${userName}`
    );

    // First get brand info to fetch team data
    const brandInfo = await getBrandInfoData(phoneNumber, requestId);

    if (brandInfo && brandInfo["Team"]) {
      // Send team message first
      const teamMessage = `You are filling CSAT for *${brandInfo["Team"]}*`;
      await sendTextMessage(phoneNumber, teamMessage);

      // Store the team message
      await storeMessageInSheets(
        requestId,
        {
          userPhoneNumber: phoneNumber,
          from: "BOT",
          text: teamMessage,
          type: "AI_RESPONSE",
          userName: "AI Assistant",
        },
        { event: "csat.team.message" },
        teamMessage
      );
    }

    // Use text-only template for csat_final2 with user's name as parameter
    return await sendTextTemplate(phoneNumber, requestId, "csat_final1", [
      {
        type: "text",
        text: userName,
      },
    ]);
  } catch (error) {
    console.error(`[${requestId}] Failed to send CSAT template:`, error);
    // Send error message with flag to prevent duplicates
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
      true
    );
  }
}

async function sendBriefTemplate(phoneNumber, requestId) {
  try {
    // Get user profile to access userName
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName =
      userProfile.userName || userProfile.firstMessageName || "there";

    console.log(
      `[${requestId}] Sending Brief template to ${phoneNumber} with name: ${userName}`
    );

    // Mark this phone number as having submitted a brief
    submittedBriefs.add(phoneNumber);

    // Send template without parameters
    return await sendTextTemplateWithoutParameters(
      phoneNumber,
      requestId,
      "new_client_brief_final"
    );
  } catch (error) {
    console.error(`[${requestId}] Failed to send brief template:`, error);
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
      true
    );
  }
}

async function sendHumanTemplate(phoneNumber, requestId) {
  try {
    // Get user profile to access userName
    const userProfile = userProfileManager.getUserProfile(phoneNumber);
    const userName =
      userProfile.userName || userProfile.firstMessageName || "there";

    console.log(
      `[${requestId}] Sending Client Support template to ${phoneNumber} with name: ${userName}`
    );

    // Send template without parameters
    const response = await sendTextTemplateWithoutParameters(
      phoneNumber,
      requestId,
      "client_asks_human_escalation"
    );

    // Store the template message with proper structure
    await storeMessageInSheets(requestId, {
      userPhoneNumber: phoneNumber,
      from: "BOT",
      text: "Sent client_asks_human_escalation template",
      type: "TEMPLATE",
      timestamp: Date.now(),
      userName: "AI Assistant",
      status: "SENT",
      messageId: response?.messages?.[0]?.id || `template-${Date.now()}`,
    });

    return response;
  } catch (error) {
    console.error(
      `[${requestId}] Failed to send Client Support template:`,
      error
    );
    // Send error message with flag to prevent duplicates
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue. You can explore the general flow by sending Hi.",
      true
    );
  }
}

// Store message in Google Sheets
async function storeMessageInSheets(
  requestId,
  messageData,
  webhookData,
  extractedMessage
) {
  try {
    if (!sheets) {
      console.error(`[${requestId}] Google Sheets API not initialized`);
      return;
    }

    if (!messageData) {
      console.error(
        `[${requestId}] No message data provided to store in sheets`
      );
      return;
    }

    // Format timestamps in IST
    const receivedTime = moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD HH:mm:ss");
    const sentTime = messageData.timestamp
      ? moment(messageData.timestamp)
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss")
      : receivedTime;

    // Generate a unique message ID if not provided
    const messageId = messageData.messageId || `msg-${uuidv4()}`;

    // Prepare values in DynamoDB-like format
    const values = [
      [
        receivedTime, // Received time (A)
        sentTime, // Sent time (B)
        messageData.from || messageData.userPhoneNumber || "BOT", // Phone number (C)
        messageData.userName || "AI Assistant", // User name (D)
        messageData.type || "UNKNOWN", // Message type (E)
        extractedMessage || messageData.text || "No message content", // Message content (F)
        messageData.status || "SENT", // Status (G)
        messageId, // Message ID (H)
        JSON.stringify({
          // Raw payload (I)
          requestId,
          messageDirection:
            messageData.from === "BOT" ? "outgoing" : "incoming",
          webhookData: webhookData || {},
          messageData: messageData || {},
        }),
      ],
    ];

    console.log(`[${requestId}] Storing message in Google Sheets:
      ID: ${messageId}
      Phone: ${values[0][2]}
      User: ${values[0][3]}
      Type: ${values[0][4]}
      Content: ${values[0][5]}
      Time: ${values[0][0]}
    `);

    // Append to the Messages sheet
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "WhatsApp_Messages!A:I",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: values,
      },
    });

    console.log(
      `[${requestId}] Message stored in Google Sheets, updated ${appendResponse.data.updates.updatedCells} cells`
    );
    return appendResponse;
  } catch (error) {
    console.error(
      `[${requestId}] Error storing message in Google Sheets:`,
      error.response?.data || error.message || error
    );
    return null;
  }
}

// Helper function to get brand info data for a phone number
async function getBrandInfoData(phoneNumber, requestId, userSession) {
  try {
    if (!sheets) {
      console.error(
        `[${
          requestId || "UNKNOWN"
        }] Error fetching BrandInfo data: Google Sheets API not initialized`
      );
      return null;
    }

    // Initialize session if not provided
    const session =
      userSession || userProfileManager.getUserProfile(phoneNumber);

    const brandInfoResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "BrandInfo!A:Z", // Extend range to include all columns including months
    });

    const rows = brandInfoResponse.data.values || [];
    if (rows.length > 1) {
      const headers = rows[0];
      const userRow = rows.slice(1).find((row) => row[0] === phoneNumber);

      if (userRow) {
        const brandInfo = {};
        headers.forEach((header, index) => {
          if (index < userRow.length) {
            brandInfo[header] = userRow[index];
          }
        });

        // Store month-specific CSAT status
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "June",
          "July",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        session.monthlyCSAT = {};
        months.forEach((month) => {
          if (brandInfo[month]) {
            session.monthlyCSAT[month] = brandInfo[month];
          }
        });

        // Log detailed month-by-month CSAT status
        console.log(`[${requestId}] Monthly CSAT status for ${phoneNumber}:`);
        for (const month of months) {
          const status = session.monthlyCSAT[month] || "Not filled";
          console.log(`[${requestId}] ${month}: ${status}`);
        }

        // Sync with Aires user profile manager
        userProfileManager.updateUserServices(phoneNumber, {
          tech: brandInfo["Tech"] === "Y",
          media: brandInfo["Media"] === "Y",
          solutions: brandInfo["Solution"] === "Y",
        });

        // Store team information for easy access
        if (brandInfo["Team"]) {
          session.teamMembers = brandInfo["Team"];
          userProfileManager.updateUserProfile(phoneNumber, {
            teamMembers: brandInfo["Team"],
          });
          console.log(
            `[${requestId}] Team information stored for ${phoneNumber}: ${brandInfo["Team"]}`
          );
        } else {
          console.log(
            `[${requestId}] No team information found for ${phoneNumber}`
          );
        }

        // Also sync monthly CSAT data with Aires
        if (session.monthlyCSAT) {
          console.log(
            `[${requestId}] Syncing monthly CSAT data with Aires user profile manager for ${phoneNumber}`
          );

          // Log before update
          const beforeProfile = userProfileManager.getUserProfile(phoneNumber);
          if (beforeProfile && beforeProfile.monthlyCSAT) {
            console.log(
              `[${requestId}] Before update - Aires profile monthlyCSAT:`,
              JSON.stringify(beforeProfile.monthlyCSAT, null, 2)
            );
          } else {
            console.log(
              `[${requestId}] Before update - No existing monthlyCSAT data in Aires profile`
            );
          }

          // Update profile
          userProfileManager.updateUserProfile(phoneNumber, {
            monthlyCSAT: session.monthlyCSAT,
          });

          // Log after update
          const afterProfile = userProfileManager.getUserProfile(phoneNumber);
          console.log(
            `[${requestId}] After update - Aires profile monthlyCSAT:`,
            JSON.stringify(afterProfile.monthlyCSAT, null, 2)
          );

          // Log current month status specifically
          const currentMonth = months[new Date().getMonth()];
          const currentStatus =
            afterProfile.monthlyCSAT && afterProfile.monthlyCSAT[currentMonth];
          console.log(
            `[${requestId}] Current month (${currentMonth}) CSAT status: ${
              currentStatus || "Not filled"
            }`
          );
        }

        console.log(
          `[${requestId}] Updated user data from sheets for ${phoneNumber}:`,
          JSON.stringify(session.services, null, 2)
        );

        // Log month data if available
        if (session.monthlyCSAT) {
          console.log(
            `[${requestId}] Monthly CSAT data for ${phoneNumber}:`,
            JSON.stringify(session.monthlyCSAT, null, 2)
          );
        }

        session.lastFetched = Date.now();

        return brandInfo;
      }
    }

    return null;
  } catch (error) {
    console.error(
      `[${requestId}] Error fetching user data from sheets:`,
      error
    );
    // Continue without failing - this is non-critical
    return null;
  }
}

// Function to get conversation history from Google Sheets
async function getConversationHistoryFromSheets(phoneNumber, limit = 20) {
  try {
    if (!sheets) {
      console.error("Google Sheets API not initialized");
      return [];
    }

    console.log(
      `Fetching conversation history for ${phoneNumber} from Google Sheets, limit ${limit}`
    );

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "WhatsApp_Messages!A:I", // Adjust range based on your columns
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log("No messages found in sheet");
      return [];
    }

    // Filter messages for this phone number and sort by timestamp
    const userMessages = rows
      .slice(1) // Skip header row
      .filter((row) => row[2] === phoneNumber) // Assuming phone number is in column C
      .map((row) => ({
        timestamp: row[0], // Received time
        sent_at: row[1], // Sent time
        phone_number: row[2],
        userName: row[3],
        type: row[4],
        content: row[5],
        status: row[6],
        messageId: row[7],
        rawPayload: row[8],
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Convert to Claude format
    return userMessages.map((msg) => ({
      role: msg.phone_number === "BOT" ? "assistant" : "user",
      content: msg.content,
    }));
  } catch (error) {
    console.error("Error fetching conversation history from sheets:", error);
    return [];
  }
}

// Send video template
async function sendVideoTemplate(phoneNumber, requestId, videoUrl, caption) {
  try {
    console.log(`[${requestId}] Sending video template to ${phoneNumber}`);

    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "video",
      video: {
        link: videoUrl,
        caption: caption,
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    try {
      const response = await axios.post(endpoint, payload, { headers });
      console.log(
        `[${requestId}] Video template response:`,
        JSON.stringify(response.data, null, 2)
      );
      return response.data;
    } catch (apiError) {
      console.error(
        `[${requestId}] API error sending video template:`,
        apiError.response?.data || apiError.message
      );
      throw new Error(`Failed to send video template: ${apiError.message}`);
    }
  } catch (error) {
    console.error(
      `[${requestId}] Error sending video template:`,
      error.message || error
    );
    throw error;
  }
}

// Send agency reel video
async function sendAgencyReelVideo(phoneNumber, requestId) {
  try {
    const videoUrl =
      "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/5045158_Do%20not%20BLINK%20From%20ideas%20to%20executions%20%20heres%20our%20story%20in%20minutes.%20Were%20proud%20to%20present%20to%20you%20all%20our%202025%20Agency%20Reel%20%20where%20every%20second%20is%20a%20reflection%20of%20the%20passion%20creativity%20and%202.mp4";
    const caption =
      "*Do not BLINK!!* From ideas to executions - here's our story in minutes. We're proud to present to you all our 2025 Agency Reel — where every second is a reflection of the passion, creativity, and dedication our Schbangers pour into every brand we work with.";

    return await sendVideoTemplate(phoneNumber, requestId, videoUrl, caption);
  } catch (error) {
    console.error(`[${requestId}] Failed to send agency reel video:`, error);
    // Send error message
    await sendTextMessage(
      phoneNumber,
      "Sorry, we encountered an issue sending the video. You can explore our other content by sending Hi.",
      true
    );
  }
}

// Send interactive message with buttons
async function sendInteractiveMessage(phoneNumber, requestId, text, buttons) {
  try {
    console.log(`[${requestId}] Sending interactive message to ${phoneNumber}`);

    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;

    const payload = {
      to: phoneNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: text,
        },
        action: {
          buttons: buttons,
        },
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    const response = await axios.post(endpoint, payload, { headers });
    console.log(
      `[${requestId}] Interactive message response:`,
      JSON.stringify(response.data, null, 2)
    );
    return response.data;
  } catch (error) {
    console.error(
      `[${requestId}] Error sending interactive message:`,
      error.message || error
    );
    throw error;
  }
}

async function sendReelsCarousel(phoneNumber, requestId) {
  try {
    const response = await fetch(
      "https://backend.aisensy.com/campaign/t1/api/v2",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3MWE0Y2Y1NWI1MTRlMGJmY2NiYTMyZCIsIm5hbWUiOiJTY2hiYW5nIERpZ2l0YWwgU29sdXRpb25zIFByaXZhdGUgTGltaXRlZCIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2NzFhNGNmNDViNTE0ZTBiZmNjYmEzMWQiLCJhY3RpdmVQbGFuIjoiQkFTSUNfTU9OVEhMWSIsImlhdCI6MTcyOTc3Njg4NX0.9x28lU0i16wkvnO6cPMUPHdGNL-lVEXVgF4LdNua8Gk",
          campaignName: "Latest_reels",
          destination: phoneNumber,
          userName: "Schbang Digital Solutions Private Limited",
          templateParams: [],
          source: "new-landing-page form",
          media: {},
          buttons: [],
          carouselCards: [
            {
              card_index: 0,
              components: [
                {
                  type: "HEADER",
                  parameters: [
                    {
                      type: "video",
                      video: {
                        link:
                          "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/8173549_schbang%20cricket.mp4",
                        },
                    },
                  ],
                },
                {
                  type: "BODY",
                  parameters: [],
                },
              ],
            },
            {
              card_index: 1,
              components: [
                {
                  type: "HEADER",
                  parameters: [
                    {
                      type: "video",
                      video: {
                        link:
                          "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/5045158_Do%20not%20BLINK%20From%20ideas%20to%20executions%20%20heres%20our%20story%20in%20minutes.%20Were%20proud%20to%20present%20to%20you%20all%20our%202025%20Agency%20Reel%20%20where%20every%20second%20is%20a%20reflection%20of%20the%20passion%20creativity%20and%202.mp4",
                      },
                    },
                  ],
                },
                {
                  type: "BODY",
                  parameters: [],
                },
              ],
            },
            {
              card_index: 2,
              components: [
                {
                  type: "HEADER",
                  parameters: [
                    {
                      type: "video",
                      video: {
                        link:
                          "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/1771268_uiux%20reel.mp4",
                      },
                    },
                  ],
                },
                {
                  type: "BODY",
                  parameters: [],
                },
              ],
            },
            {
              card_index: 3,
              components: [
                {
                  type: "HEADER",
                  parameters: [
                    {
                      type: "video",
                      video: {
                        link:
                          "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/795591_schbang%20founder%20story.mp4",
                      },
                    },
                  ],
                },
                {
                  type: "BODY",
                  parameters: [],
                },
              ],
            },
            {
              card_index: 4,
              components: [
                {
                  type: "HEADER",
                  parameters: [
                    {
                      type: "video",
                      video: {
                        link:
                          "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/VIDEO/671a4cf55b514e0bfccba32d/8547314_schbang%20visual%20search%20reel.mp4",
                      },
                    },
                  ],
                },
                {
                  type: "BODY",
                  parameters: [],
                },
              ],
            },
          ],
          location: {},
          attributes: {},
          paramsFallbackValue: {},
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send reels carousel: ${response.statusText}`);
    }

    await storeMessageInSheets(requestId, {
      from: "BOT",
      text: "Sent latest reels carousel",
      type: "TEMPLATE",
      timestamp: Date.now(),
    });

    // Store in conversation history
    await addMessageWithTimestamp(
      phoneNumber,
      "assistant",
      "Sent latest reels carousel"
    );

    return true;
  } catch (error) {
    console.error(`[${requestId}] Error sending reels carousel:`, error);
    throw error;
  }
}

// Helper to append CSAT submission to CSAT_Log sheet
async function appendCSATLog({
  phoneNumber,
  userName,
  month,
  responseJson,
  rawMessage,
  requestId,
}) {
  try {
    if (!sheets) {
      console.error(
        `[${requestId}] Google Sheets API not initialized for CSAT_Log`
      );
      return;
    }
    const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    // Flatten responseJson if it's an object
    let answers = [];
    if (responseJson && typeof responseJson === "object") {
      answers = Object.entries(responseJson).map(
        ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
      );
    } else if (typeof responseJson === "string") {
      answers = [responseJson];
    }
    const row = [
      timestamp, // A: Timestamp
      phoneNumber, // B: Phone Number
      userName || "", // C: User Name
      month, // D: Month
      ...answers, // E...: Answers
      JSON.stringify(rawMessage || {}), // Last: Raw message for traceability
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "CSAT_Log!A1",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: { values: [row] },
    });
    console.log(
      `[${requestId}] Appended CSAT submission to CSAT_Log for ${phoneNumber}`
    );
  } catch (err) {
    console.error(
      `[${requestId}] Failed to append CSAT to CSAT_Log:`,
      err.message || err
    );
  }
}

module.exports = router;
