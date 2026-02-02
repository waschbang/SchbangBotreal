/**
 * Template manager for Aires
 * Handles CSAT templates and other message templates
 */

const axios = require("axios");

/**
 * Send template message with image and personalized content
 * @param {String} phoneNumber - Recipient phone number
 * @param {String} userName - User's name for personalization
 * @param {String} templateName - Name of the template
 * @param {String} imageUrl - URL of the image to include
 * @param {String} projectId - AISensy project ID
 * @param {String} apiKey - AISensy API key
 * @param {String} requestId - Request ID for logging
 * @returns {Promise<Object>} - API response
 */
async function sendTemplateWithImage(
  phoneNumber, 
  userName,
  templateName,
  imageUrl,
  projectId,
  apiKey,
  requestId
) {
  try {
    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${projectId}/messages`;
    
    // Default image if none provided
    const finalImageUrl = imageUrl || "https://images.pexels.com/photos/616838/pexels-photo-616838.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";
    
    // Construct template payload
    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        language: {
          policy: "deterministic",
          code: "en"
        },
        name: templateName,
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: {
                  link: finalImageUrl
                }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: userName || "there"
              }
            ]
          }
        ]
      }
    };
    
    const headers = {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': apiKey
    };
    
    console.log(`[${requestId}] Sending template with image to ${phoneNumber}`);
    console.log(`[${requestId}] Template payload:`, JSON.stringify(payload, null, 2));
    
    const response = await axios.post(endpoint, payload, { headers });
    console.log(`[${requestId}] Template sent successfully:`, JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.error(`[${requestId}] Error sending template:`, error.response?.data || error.message || error);
    throw error;
  }
}

/**
 * Send CSAT template with image
 * @param {String} phoneNumber - Recipient phone number
 * @param {String} userName - User's name for personalization
 * @param {String} projectId - AISensy project ID
 * @param {String} apiKey - AISensy API key
 * @param {String} requestId - Request ID for logging
 * @returns {Promise<Object>} - API response
 */
async function sendCSATTemplate(phoneNumber, userName, projectId, apiKey, requestId) {
  // Use the finalfinalfinal template with default image
  return sendTemplateWithImage(
    phoneNumber,
    userName,
    "finalfinalfinal",
    "https://whatsapp-media-library.s3.ap-south-1.amazonaws.com/IMAGE/671a4cf55b514e0bfccba32d/5307924_ChatGPT%20Image%20Apr%2018%202025%20021351%20AM.png",
    projectId,
    apiKey,
    requestId
  );
}

module.exports = {
  sendTemplateWithImage,
  sendCSATTemplate
};
