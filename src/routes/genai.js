const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const Anthropic = require("@anthropic-ai/sdk");

const router = express.Router();
router.use(express.json({ limit: "10mb" }));

// ===== DB Config (Postgres for genai only) =====
const GENAI_TABLE = "genai_messages";
// Hardcoded DB config per user request (genai only)
const pool = new Pool({
  host: "second-brain.crgygeose77d.ap-south-1.rds.amazonaws.com",
  port: 5432,
  database: "genai",
  user: "postgres",
  password: "WAschbang1234",
  max: 10, // connection limit
  ssl: { rejectUnauthorized: false } // allow self-signed/chain issues
});

// Surface unexpected pool errors
pool.on("error", (err) => {
  console.error("[genai][pg] Pool error:", err.message, err.stack);
});

async function ensureGenaiTable() {
  // Create table and index if not present
  await pool.query(`
    CREATE TABLE IF NOT EXISTS genai_messages (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now(),
      message_ts TIMESTAMPTZ DEFAULT now(),
      phone_number TEXT NOT NULL,
      phone_10 TEXT NOT NULL,
      user_name TEXT,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT,
      raw JSONB
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_genai_messages_phone10_created ON genai_messages (phone_10, created_at DESC)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_genai_messages_phone10_mts ON genai_messages (phone_10, message_ts DESC)`
  );
}

// Tiny helper to fetch the latest assistant message only (for affirmative detection); fast and light
async function getLastAssistantMessage(phone) {
  const needle = normalizeNumber(phone);
  try {
    const { rows } = await pool.query(
      `SELECT content FROM genai_messages
       WHERE phone_10 = $1 AND role = 'assistant'
       ORDER BY message_ts DESC
       LIMIT 1`,
      [needle]
    );
    return rows?.[0]?.content || "";
  } catch (e) {
    console.error("[genai] Last assistant lookup failed:", e.message);
    return "";
  }
}

// Detects if the user is affirmatively agreeing to schedule after assistant asked
function isAffirmativeForAppointment(userMessage, previousMessages = []) {
  const msg = String(userMessage || '').toLowerCase();
  const affirmative = /\b(yes|yeah|yup|ok|okay|kk|sure|please|do it|go ahead|confirm|book|schedule|let's do it|done)\b/i.test(msg);
  if (!affirmative) return false;
  // Look at the most recent assistant message for scheduling intent
  const lastAssistant = [...(previousMessages || [])].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return false;
  const la = String(lastAssistant.content || '').toLowerCase();
  const assistantAsked = /(schedule|book).*(appointment)|appointment.*(schedule|book)|shall i|should i|want me to/i.test(la);
  return assistantAsked;
}

// Initialize table on module load
(async () => {
  try {
    await ensureGenaiTable();
    console.log("[genai] Postgres table ensured");
  } catch (e) {
    console.error("[genai] Failed to ensure Postgres table:", e.message);
  }
})();

// ===== External API keys (kept same style as original for compatibility) =====
const CLAUDE_API_KEY = "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";
const AISENSY_API_KEY = "56e47afac4e7fcbcf0806";
const PROJECT_ID = "68778bfb52435a133a4b3039";

async function insertGenaiMessage({ phone, userName, role, content, raw, messageTs }) {
  const phone_10 = normalizeNumber(phone);
  const rawJson = (() => {
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return { raw };
    }
  })();

  await ensureGenaiTable();
  const { rows } = await pool.query(
    `INSERT INTO genai_messages (message_ts, phone_number, phone_10, user_name, role, content, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [messageTs ? new Date(messageTs) : new Date(), String(phone || ""), phone_10, String(userName || ""), role, String(content || ""), rawJson]
  );
  return rows?.[0]?.id;
}

// Keep function name for compatibility; now writes only the AI reply to DB
async function appendWithAIToGenaiSheet({ phone, userName, text, raw, aiReply, messageTs }) {
  const id = await insertGenaiMessage({
    phone,
    userName: "AI Assistant",
    role: "assistant",
    content: aiReply,
    raw: { note: "genai_reply" },
    messageTs: messageTs || new Date(),
  });
  console.log(`[genai] Stored assistant reply in DB (id=${id})`);
}

// Clinic system prompt
const CLINIC_SYSTEM_PROMPT = `You are a polite, professional, and friendly receptionist AI for Sunshine Health Clinic.

Clinic Information:
- Clinic Name: Sunshine Health Clinic
- Address: 123 Wellness Street, Demo City, State, 456789
- Contact Numbers: +1-234-567-8901
- Operating Hours / Working Days:
  - Monday – Friday: 9:00 AM – 6:00 PM
  - Saturday: 10:00 AM – 2:00 PM
  - Sunday: Closed
- Services Offered:
  - General consultations
  - Pediatrics
  - Lab tests (blood tests, urine tests, etc.)
  - Vaccinations
  - Health check-ups
- Doctors’ Availability:
  - Dr. Alice Smith – General Physician (Mon, Wed, Fri, 9:00 AM – 1:00 PM)
  - Dr. Bob Johnson – Pediatrician (Tue, Thu, 10:00 AM – 4:00 PM)
- Insurance / Payment Options: Cash, Credit/Debit Cards, Health Insurance
- Emergency Info: In case of emergencies, call 911 or visit the nearest hospital.

Common Patient Queries & Answers:
- How to reach the clinic / parking info: "Sunshine Health Clinic is located at 123 Wellness Street, Demo City. Free parking is available in front of the clinic. Nearest bus stop is ‘Wellness Street Stop’ just 2 minutes away."
- Consultation fees: "The standard consultation fee is $50 for general physicians and $60 for pediatricians. Fees are payable via cash, card, or insurance."
- Lab test pricing: "Our lab tests range from $20 to $100 depending on the test. Blood test costs $30, urine test $25, and full health check-up $100."
- Vaccinations offered: "We offer common vaccinations including flu shots, MMR, hepatitis B, and COVID-19 vaccines. Let us know which vaccine you need to check availability."
- COVID / health guidelines: "Please wear masks, sanitize hands at entry, and maintain social distancing. If you have symptoms like fever or cough, inform us before visiting."
- How to collect medical reports: "Reports are available within 2 days of your visit. Collect them in person at reception or request a digital copy via email or WhatsApp."
- Operating hours or days off: "We are open Monday to Friday 9 AM–6 PM and Saturday 10 AM–2 PM. We are closed on Sundays."
- Doctor availability: "Dr. Alice Smith (General Physician) is available Mon, Wed, Fri 9 AM–1 PM. Dr. Bob Johnson (Pediatrician) is available Tue, Thu 10 AM–4 PM."
- Payment / insurance info: "We accept cash, credit/debit cards, and most health insurance plans."

Conversation Guidelines / Tone:
- Be polite, professional, and friendly.
- Keep responses clear and concise, ideally under 80–100 words.
- Avoid giving medical diagnoses.
- Use fallback answers for unknown queries, e.g.: "I’m not sure about that, but I can connect you to our clinic staff."
- Personalize responses when possible (greet by name if known).

Hard rules for tone and brevity:
- Never introduce yourself as an AI/bot or receptionist.
- Do not propose scheduling or list services unless the user asks about it.
- Keep replies natural, warm, and short (1–2 sentences max).
- Do not ask follow-up questions; answer directly with what's requested.
- If the user mentions appointments/booking, do not ask for time or details. The system will send a booking template separately.

Emergency / Escalation Rules:
- If the patient mentions urgent symptoms: "Please contact emergency services at 911 or visit the nearest hospital immediately."
- For questions the bot cannot answer: escalate to human staff politely.

Miscellaneous:
- Handle repeated or unclear questions with a brief apology and ask to rephrase.
- Show empathy when appropriate.
`;

// Normalize to last 10 digits to match stored DB values
function normalizeNumber(num) {
  return num ? String(num).replace(/\D/g, "").slice(-10) : "";
}

// Lightweight in-memory context cache to cut DB round trips
const contextCache = new Map(); // key: phone_10, value: { at:number, msgs:Array }
const CONTEXT_TTL_MS = 15000; // 15s cache is enough for rapid back-and-forth

async function getPreferredName(phone, fallbackName = "") {
  const needle = normalizeNumber(phone);
  if (fallbackName && fallbackName.trim()) return fallbackName;
  try {
    const { rows } = await pool.query(
      `SELECT user_name FROM genai_messages
       WHERE phone_10 = $1 AND user_name IS NOT NULL AND user_name <> ''
       ORDER BY message_ts DESC
       LIMIT 1`,
      [needle]
    );
    return (rows?.[0]?.user_name || "").trim() || fallbackName;
  } catch (e) {
    console.error("[genai] Name lookup failed:", e.message);
    return fallbackName;
  }
}

async function getLastNMessagesFromSheet(phone, n = 6) {
  const needle = normalizeNumber(phone);
  // Try cache first
  const now = Date.now();
  const cached = contextCache.get(needle);
  if (cached && now - cached.at < CONTEXT_TTL_MS && cached.msgs?.length) {
    return cached.msgs.slice(-n);
  }
  console.log(`[genai] Fetching last ${n} messages from DB for:`, needle);
  try {
    const { rows } = await pool.query(
      `SELECT role, content, message_ts FROM genai_messages
       WHERE phone_10 = $1
       ORDER BY message_ts DESC
       LIMIT $2`,
      [needle, n]
    );
    console.log(`[genai] Retrieved ${rows.length} rows for ${needle}`);
    // Return in chronological order
    const msgs = rows.map(r => ({ role: r.role, content: r.content || "" })).reverse();
    contextCache.set(needle, { at: now, msgs });
    return msgs;
  } catch (e) {
    console.error(`[genai] DB history query failed:`, e.message);
    return [];
  }
}

function toClaudeMessage(msg) {
  return {
    role: msg.role,
    content: [{ type: "text", text: String(msg.content || "") }],
  };
}

// Split text into sentences without breaking on common abbreviations (e.g., "Dr.")
function splitIntoSentences(input) {
  if (!input) return [];
  let t = String(input);
  const abbr = [
    'dr.', 'mr.', 'ms.', 'mrs.', 'prof.', 'st.', 'no.', 'vs.', 'inc.', 'ltd.', 'jr.', 'sr.', 'dept.', 'dist.'
  ];
  // Protect abbreviations by replacing the period with a placeholder
  const placeholder = '∯';
  abbr.forEach(a => {
    const re = new RegExp(a.replace('.', '\\.'), 'gi');
    t = t.replace(re, (m) => m.slice(0, -1) + placeholder);
  });
  // Now split on sentence boundaries
  const raw = t.split(/(?<=[.!?])\s+/);
  // Restore placeholders and trim
  const out = raw.map(s => s.replace(new RegExp(placeholder, 'g'), '.').trim()).filter(Boolean);
  return out;
}

// Ensure replies are short, human, and to-the-point
function makeConcise(text) {
  if (!text) return "";
  // Preserve intentional newlines if model returns them, but normalize excessive spaces
  let t = String(text).replace(/[\t ]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  const parts = splitIntoSentences(t);
  // Allow up to 3 concise sentences (user allowed a bit more if not costly)
  t = parts.slice(0, 3).join(' ');
  // Avoid list-y bullets at the start
  t = t.replace(/^[•\-\d)]+\s*/g, "");
  // Ensure terminal punctuation
  if (t && !/[.!?…]$/.test(t)) t = t + '.';
  return t;
}

// Detect simple greetings without a concrete request
function isGreetingOnly(text) {
  if (!text) return false;
  const t = String(text).trim();
  const greeting = /^(hi|hello|hey|yo|hiya|h[e|i]y|good\s*(morning|evening|afternoon))\b/i.test(t);
  const hasQuestion = /[?]/.test(t);
  const hasKeyword = /(time|timing|hours|open|close|appointment|book|schedule|doctor|fees|price|report|vaccine|vaccination)/i.test(t);
  const tokenCount = t.split(/\s+/).filter(Boolean).length;
  return greeting && !hasQuestion && !hasKeyword && tokenCount <= 6;
}

function makeWarmGreeting(name) {
  const first = (name && String(name).trim()) ? ` ${String(name).split(" ")[0]}` : "";
  const options = [
    `Hi${first}, how can I help you today?`,
    `Hey${first}! How can I help?`
  ];
  return options[Math.floor(Date.now() / 1000) % options.length];
}

async function generateClinicReply(userMessage, previousMessages = []) {
  if (!CLAUDE_API_KEY) throw new Error("Claude API key not configured (set CLAUDE_API_KEY)");
  const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY });
  const msg = await anthropic.messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 200,
    temperature: 0.1,
    system: CLINIC_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Write a warm, human reply in 1–2 short sentences. Only answer what is asked; do not add extra details.\n\nPatient message: ${String(userMessage || "").trim()}`,
          },
        ],
      },
    ],
  });
  const content = Array.isArray(msg.content) ? msg.content.map((c) => c.text).join("\n").trim() : String(msg.content || "");
  const concise = makeConcise(content);
  return concise || "How can I help you today?";
}

// Sheets removed: genai now uses Postgres for storage and retrieval

// ===== Helpers =====
function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}

// Send clinic appointment template
async function sendClinicAppointmentTemplate(phoneNumber, requestId) {
  try {
    console.log(`[${requestId}] Sending clinic appointment template to ${phoneNumber}`);
    
    const endpoint = `https://apis.aisensy.com/project-apis/v1/project/${PROJECT_ID}/messages`;
    
    const payload = {
      to: phoneNumber,
      type: "template",
      template: {
        name: "clinicappoinment2",
        language: {
          code: "en",
          policy: "deterministic"
        }
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "X-AiSensy-Project-API-Pwd": AISENSY_API_KEY,
    };

    const response = await axios.post(endpoint, payload, {
      headers,
      timeout: 10000,
    });

    console.log(`[${requestId}] Clinic appointment template sent successfully`);
    console.log(`[${requestId}] Response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(`[${requestId}] Error sending clinic appointment template:`, error.response?.data || error.message || error);
    throw error;
  }
}

// Detect if user is asking about appointments
function isAppointmentRequest(message) {
  const appointmentKeywords = [
    /\bbook.*appointment\b/i,
    /\bschedule.*appointment\b/i,
    /\bmake.*appointment\b/i,
    /\bappointment\b/i,
    /\bbook.*meeting\b/i,
    /\bschedule.*meeting\b/i,
    /\bmeet.*doctor\b/i,
    /\bsee.*doctor\b/i,
    /\bvisit.*clinic\b/i,
    /\bconsultation\b/i,
    /\bcheck.*up\b/i,
    /\bcheckup\b/i,
    /\bwhen.*available\b/i,
    /\bcan.*i.*come\b/i,
    /\bwant.*to.*meet\b/i,
    /\bneed.*appointment\b/i,
  ];

  return appointmentKeywords.some(pattern => pattern.test(message));
}

// Send text message via AISensy API
async function sendTextMessage(phoneNumber, text, requestId) {
  const startTime = Date.now();
  console.log(`[${requestId}] [sendTextMessage] Starting to send message to ${phoneNumber}`);
  console.log(`[${requestId}] [sendTextMessage] Message text: "${text}"`);

  // Validate that text is defined
  if (text === undefined || text === null) {
    console.error(`[${requestId}] [sendTextMessage] Attempting to send undefined/null text to ${phoneNumber}`);
    text = "Sorry, I couldn't generate a proper response. Please try again.";
  }

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
      console.log(`[${requestId}] [sendTextMessage] Making API call to AISensy`);

      try {
        const response = await axios.post(endpoint, payload, {
          headers,
          timeout: 10000, // 10 second timeout
        });

        const apiEndTime = Date.now();
        const apiDuration = apiEndTime - apiStartTime;
        console.log(`[${requestId}] [sendTextMessage] AISensy API call completed in ${apiDuration}ms`);
        console.log(`[${requestId}] [sendTextMessage] AISensy API response:`, JSON.stringify(response.data, null, 2));

        const endTime = Date.now();
        const totalDuration = endTime - startTime;
        console.log(`[${requestId}] [sendTextMessage] Total message sending completed in ${totalDuration}ms`);

        return response.data;
      } catch (axiosError) {
        const errorTime = Date.now();
        console.error(`[${requestId}] [sendTextMessage] API call failed after ${errorTime - apiStartTime}ms:`, axiosError.message);
        throw axiosError;
      }
    } catch (error) {
      retryCount++;
      const retryTime = Date.now();

      if (retryCount >= MAX_RETRIES) {
        console.error(`[${requestId}] [sendTextMessage] Failed to send message after ${MAX_RETRIES} attempts (${retryTime - startTime}ms total):`, error.response?.data || error.message || error);
        return {
          success: false,
          error: error.message || "Failed to send message",
          duration: retryTime - startTime,
        };
      }

      console.warn(`[${requestId}] [sendTextMessage] Error sending text message (attempt ${retryCount}/${MAX_RETRIES}):`, error.response?.data || error.message || error);

      const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, delay));
      console.log(`[${requestId}] [sendTextMessage] Retrying after ${delay}ms delay...`);
    }
  }
}

function extractPhoneAndText(body) {
  const phone = body?.phone_number || body?.data?.message?.phone_number || body?.phoneNumber || body?.number || body?.from || body?.phone || "";
  const mc = body?.data?.message?.message_content || {};
  const textCandidates = [
    mc?.text,
    body?.text,
    body?.message,
    body?.body,
    body?.data?.message?.text,
  ].filter(Boolean);
  const text = typeof textCandidates[0] === "string" ? textCandidates[0] : (typeof textCandidates[0] === "object" ? textCandidates[0]?.body : "");
  return { phone, text: text || "" };
}

async function appendWebhookToGenaiSheet({ phone, userName, text, raw, messageTs }) {
  try {
    const id = await insertGenaiMessage({ phone, userName, role: "user", content: text, raw, messageTs });
    console.log(`[genai] Stored user message in DB (id=${id})`);
  } catch (e) {
    console.error("[genai] Failed to log webhook to DB:", e.message, e.stack);
  }
}

// ===== Route: process AI reply and send to WhatsApp =====
// POST /api/genai  { phone_number?: string, text?: string, ... }
router.post("/", async (req, res) => {
  const requestStartTime = Date.now();
  const requestId = `genai-${requestStartTime}`;
  
  const body = req.body || {};
  const raw = safeStringify(body);
  
  console.log(`[${requestId}] ========== NEW REQUEST ==========`);
  console.log(`[${requestId}] Request received at: ${new Date(requestStartTime).toISOString()}`);
  console.log(`[${requestId}] Full webhook body:`, raw);

  try {
    // Check if this is a user message
    if (body.topic !== "message.sender.user") {
      console.log(`[${requestId}] Not a user message (topic: ${body.topic}). Ignoring.`);
      return res.status(200).json({ status: "ignored", reason: "Not a user message" });
    }

    // Extract message data from webhook
    const message = body?.data?.message;
    if (!message) {
      console.log(`[${requestId}] ERROR: No message data in webhook`);
      return res.status(400).json({ message: "No message data found", logged: false });
    }

    const phone = message.phone_number;
    const userName = await getPreferredName(phone, message.userName || "");
    const userMessage = message.message_content?.text || "";
    const messageTimestamp = message.sent_at || Date.now();

    console.log(`[${requestId}] Extracted data:`);
    console.log(`[${requestId}]   - Phone: ${phone}`);
    console.log(`[${requestId}]   - User: ${userName}`);
    console.log(`[${requestId}]   - Message: ${userMessage}`);
    console.log(`[${requestId}]   - Timestamp: ${new Date(messageTimestamp).toISOString()}`);

    // Check if message is too old (more than 30 seconds)
    const messageAge = Date.now() - messageTimestamp;
    const MAX_MESSAGE_AGE = 30 * 1000; // 30 seconds

    if (messageAge > MAX_MESSAGE_AGE) {
      console.log(`[${requestId}] Message is ${messageAge}ms old, exceeding maximum age of ${MAX_MESSAGE_AGE}ms. Ignoring.`);
      return res.status(200).json({ status: "ignored", reason: "Message too old" });
    }

    if (!userMessage) {
      console.log(`[${requestId}] ERROR: No message text provided`);
      return res.status(400).json({ message: "'text' is required in body", logged: false });
    }

    if (!phone) {
      console.log(`[${requestId}] ERROR: No phone number provided`);
      return res.status(400).json({ message: "'phone' is required in body", logged: false });
    }

    // Defer DB writes to after we send a reply (optimize latency)

    const normalized = String(userMessage).trim().toLowerCase();
    if (normalized === "reserve your appoinment") {
      console.log(`[${requestId}] Keyword 'Reserve Your Appoinment' detected. Ignoring.`);
      return res.status(200).json({ status: "ignored", reason: "keyword Reserve Your Appoinment" });
    }

    // Step 1: Check if user is asking about appointments
    console.log(`[${requestId}] [STEP 0] Checking for appointment request...`);
    const isAppointment = isAppointmentRequest(userMessage);
    console.log(`[${requestId}] [STEP 0] Is appointment request: ${isAppointment}`);

    if (isAppointment) {
      console.log(`[${requestId}] [STEP 0] Appointment request detected! Sending clinic appointment template...`);
      
      const sendStartTime = Date.now();
      await sendClinicAppointmentTemplate(phone, requestId);
      const sendEndTime = Date.now();
      
      console.log(`[${requestId}] [STEP 0] Clinic appointment template sent in ${sendEndTime - sendStartTime}ms`);
      
      // Kick off background logging (user + assistant note)
      Promise.all([
        appendWebhookToGenaiSheet({ phone, userName, text: userMessage, raw, messageTs: messageTimestamp }).catch(e => console.error(`[${requestId}] [STORE] Failed user log:`, e.message)),
        appendWithAIToGenaiSheet({ phone, userName, text: userMessage, raw, aiReply: "[Sent clinic appointment template]", messageTs: Date.now() }).catch(e => console.error(`[${requestId}] [STORE] Failed assistant log:`, e.message))
      ]).then(() => console.log(`[${requestId}] [STORE] Background appointment logs completed.`));

      console.log(`[${requestId}] ========== REQUEST COMPLETED ==========`);
      return res.status(200).json({ 
        status: "success",
        phone, 
        userName,
        message: userMessage,
        action: "Sent clinic appointment template"
      });
    }

    // Step 1: Context disabled for latency; only fetch last assistant message when needed
    const contextStartTime = Date.now();
    console.log(`[${requestId}] [STEP 1] Context disabled (fetching minimal state)`);
    const lastAssistant = await getLastAssistantMessage(phone);
    const previousMessages = lastAssistant ? [{ role: "assistant", content: lastAssistant }] : [];
    const contextEndTime = Date.now();
    console.log(`[${requestId}] [STEP 1] Minimal state fetched in ${contextEndTime - contextStartTime}ms`);

    // Step 2: If user affirms scheduling, trigger template immediately (booking only via template)
    if (isAffirmativeForAppointment(userMessage, previousMessages)) {
      console.log(`[${requestId}] [STEP 2] Affirmative to schedule detected. Sending clinic appointment template...`);
      const sendStartTime = Date.now();
      await sendClinicAppointmentTemplate(phone, requestId);
      const sendEndTime = Date.now();
      console.log(`[${requestId}] [STEP 2] Appointment template sent in ${sendEndTime - sendStartTime}ms`);
      // Background logs
      Promise.all([
        appendWebhookToGenaiSheet({ phone, userName, text: userMessage, raw, messageTs: messageTimestamp }).catch(e => console.error(`[${requestId}] [STORE] Failed user log:`, e.message)),
        appendWithAIToGenaiSheet({ phone, userName, text: userMessage, raw, aiReply: "[Sent clinic appointment template]", messageTs: Date.now() }).catch(e => console.error(`[${requestId}] [STORE] Failed assistant log:`, e.message))
      ]).then(() => console.log(`[${requestId}] [STORE] Background appointment logs completed.`));
      console.log(`[${requestId}] ========== REQUEST COMPLETED ==========`);
      return res.status(200).json({
        status: 'success',
        phone,
        userName,
        message: userMessage,
        action: 'Sent clinic appointment template (affirmative)'
      });
    }

    // Step 2: Generate AI reply
    const aiStartTime = Date.now();
    console.log(`[${requestId}] [STEP 2] Generating AI reply...`);
    
    // If user is asking about their last/previous messages or questions, answer deterministically
    const wantsHistory = /\b(last|previous|recent)\b.*\b(message|messages|question|questions|chat|conversation)\b/i.test(userMessage);
    let aiReply;
    if (isGreetingOnly(userMessage)) {
      aiReply = makeWarmGreeting(userName);
    } else if (wantsHistory && previousMessages.length) {
      const recentUser = previousMessages.filter(m => m.role === "user").slice(-5);
      if (recentUser.length) {
        const list = recentUser.map((m, i) => `${i + 1}. ${m.content}`).join("; ");
        aiReply = makeConcise(`Your recent messages: ${list}`);
      } else {
        aiReply = "I couldn't find any recent user messages for this number.";
      }
    } else {
      aiReply = await generateClinicReply(userMessage, previousMessages);
    }
    
    const aiEndTime = Date.now();
    console.log(`[${requestId}] [STEP 2] AI reply generated in ${aiEndTime - aiStartTime}ms`);
    console.log(`[${requestId}] [STEP 2] AI reply length: ${aiReply.length} characters`);
    console.log(`[${requestId}] [STEP 2] AI reply preview: "${aiReply.substring(0, 100)}..."`);
    
    // Step 3: Send message to WhatsApp (PRIORITY - do this before logging)
    const sendStartTime = Date.now();
    console.log(`[${requestId}] [STEP 3] Sending message to WhatsApp...`);
    const sendResult = await sendTextMessage(phone, aiReply, requestId);
    const sendEndTime = Date.now();
    console.log(`[${requestId}] [STEP 3] Message sent in ${sendEndTime - sendStartTime}ms`);
    console.log(`[${requestId}] [STEP 3] Send result:`, sendResult);

    // Calculate response time
    const totalResponseTime = sendEndTime - requestStartTime;
    console.log(`[${requestId}] ====== TIMING SUMMARY ======`);
    console.log(`[${requestId}] Context fetch: ${contextEndTime - contextStartTime}ms`);
    console.log(`[${requestId}] AI generation: ${aiEndTime - aiStartTime}ms`);
    console.log(`[${requestId}] Message send: ${sendEndTime - sendStartTime}ms`);
    console.log(`[${requestId}] TOTAL RESPONSE TIME: ${totalResponseTime}ms`);
    console.log(`[${requestId}] ============================`);

    // Step 4: Start background logging to keep response snappy
    Promise.all([
      appendWebhookToGenaiSheet({ phone, userName, text: userMessage, raw, messageTs: messageTimestamp }).catch(e => console.error(`[${requestId}] [STORE] Failed user log:`, e.message)),
      appendWithAIToGenaiSheet({ phone, userName, text: userMessage, raw, aiReply, messageTs: Date.now() }).catch(e => console.error(`[${requestId}] [STORE] Failed assistant log:`, e.message))
    ]).then(() => console.log(`[${requestId}] [STORE] Background logs completed.`));

    // Debug summary of context included
    const contextSummary = previousMessages.map((m, i) => ({ idx: i, role: m.role, content: m.content.substring(0, 50) })).slice(-10);

    console.log(`[${requestId}] ========== REQUEST COMPLETED ==========`);
    console.log(`[${requestId}] Response sent successfully to ${phone}`);
    
    return res.status(200).json({ 
      status: "success", 
      messageSent: true,
      phone, 
      userName,
      message: userMessage, 
      aiReply, 
      contextUsedCount: previousMessages.length, 
      contextPreview: contextSummary,
      timings: {
        contextFetch: `${contextEndTime - contextStartTime}ms`,
        aiGeneration: `${aiEndTime - aiStartTime}ms`,
        messageSend: `${sendEndTime - sendStartTime}ms`,
        totalResponse: `${totalResponseTime}ms`
      }
    });
  } catch (err) {
    console.error(`[${requestId}] ========== ERROR ==========`);
    console.error(`[${requestId}] Error:`, err.response?.data || err.message || err);
    console.error(`[${requestId}] Stack:`, err.stack);
    
    // Try to log error to DB
    try {
      const phone = body?.data?.message?.phone_number || "";
      const userName = body?.data?.message?.userName || "";
      const userMessage = body?.data?.message?.message_content?.text || "";
      await appendWebhookToGenaiSheet({ phone, userName, text: userMessage || "(error)", raw: raw + " | ERROR: " + (err.message || String(err)) });
      console.log(`[${requestId}] Error logged to DB`);
    } catch (logErr) {
      console.error(`[${requestId}] Failed to log error to DB:`, logErr.message);
    }
    
    console.error(`[${requestId}] ============================`);
    return res.status(500).json({ 
      status: "error",
      messageSent: false,
      message: "Failed to process request", 
      error: err.message || String(err), 
      logged: true 
    });
  }
});

module.exports = router;
