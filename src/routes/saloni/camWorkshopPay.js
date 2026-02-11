const express = require("express");
const moment = require("moment-timezone");
const { getGoogleSheets } = require("../../lib/googleAuth");
const { sendCamConfirmationEmail } = require("../../lib/saloni/CAM_mail");

const router = express.Router();

const sheets = getGoogleSheets();
const SPREADSHEET_ID = "1HG8iWAHMDHDUnElzrEuzono5q_Ge-BjVBnuz7tTYlYI";

let cachedSheetTitle = null;

const COMPLETION_EVENTS = new Set([
  "payment.captured",
  "payment.authorized",
  "order.paid",
  "payment_link.paid",
  "subscription.charged",
]);

const processedPayments = new Map();
const DEDUP_TTL_MS = 6 * 60 * 60 * 1000;

function isDuplicatePayment(paymentId) {
  if (!paymentId) return false;
  const now = Date.now();
  const lastSeen = processedPayments.get(paymentId);
  if (lastSeen && now - lastSeen < DEDUP_TTL_MS) return true;
  processedPayments.set(paymentId, now);
  return false;
}

function cleanupProcessedPayments() {
  const now = Date.now();
  for (const [paymentId, ts] of processedPayments.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedPayments.delete(paymentId);
  }
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function normalizeKey(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function mergeObjects(...sources) {
  return Object.assign({}, ...sources.map(asPlainObject));
}

function pickFirst(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return "";
}

function pickNoteValue(notes, ...keys) {
  const noteObj = asPlainObject(notes);
  const normalizedMap = Object.keys(noteObj).reduce((acc, key) => {
    acc[normalizeKey(key)] = key;
    return acc;
  }, {});

  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    const actualKey = normalizedMap[normalizedKey];
    if (actualKey !== undefined) {
      return noteObj[actualKey];
    }
  }

  return "";
}

function pickNoteByContains(notes, needle) {
  const noteObj = asPlainObject(notes);
  const normalizedNeedle = normalizeKey(needle);
  if (!normalizedNeedle) return "";

  const matchKey = Object.keys(noteObj).find((key) =>
    normalizeKey(key).includes(normalizedNeedle)
  );

  return matchKey ? noteObj[matchKey] : "";
}

function getNested(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function extractRazorpayData(body) {
  const payment = getNested(body, "payload.payment.entity") || {};
  const order = getNested(body, "payload.order.entity") || {};
  const paymentLink = getNested(body, "payload.payment_link.entity") || {};
  const invoice = getNested(body, "payload.invoice.entity") || {};

  const notes = mergeObjects(
    payment.notes,
    order.notes,
    paymentLink.notes,
    invoice.notes,
    body.notes
  );

  const customerDetails = mergeObjects(
    payment.customer_details,
    order.customer_details,
    paymentLink.customer_details,
    invoice.customer_details
  );

  const paymentLinkCustomer = asPlainObject(paymentLink.customer);

  const fullName = pickFirst(
    pickNoteValue(notes, "full_name", "full name", "name", "customer_name", "customer name"),
    pickNoteByContains(notes, "name"),
    payment.name,
    paymentLinkCustomer.name,
    customerDetails.name,
    order.payer_name,
    payment.customer_name,
    payment.card && payment.card.name
  );

  const age = pickFirst(
    pickNoteValue(notes, "age", "customer_age", "customer age"),
    customerDetails.age
  );

  const city = pickFirst(
    pickNoteValue(notes, "city", "customer_city", "customer city"),
    customerDetails.city
  );

  const phoneNumber = pickFirst(
    pickNoteValue(notes, "phone", "phone_number", "phone number", "phoneNumber", "mobile", "contact"),
    payment.contact,
    order.contact,
    customerDetails.contact,
    paymentLinkCustomer.contact
  );

  const emailId = pickFirst(
    pickNoteValue(notes, "email", "email_id", "email id", "emailId"),
    payment.email,
    order.email,
    customerDetails.email,
    paymentLinkCustomer.email
  );

  return { fullName, age, city, phoneNumber, emailId };
}

async function resolveSheetTitle() {
  if (cachedSheetTitle) return cachedSheetTitle;

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });
    const firstSheet = (meta.data.sheets || [])[0];
    cachedSheetTitle = firstSheet?.properties?.title || "Sheet1";
  } catch (error) {
    console.error("[saloni cam_workshop] Failed to resolve sheet title:", error.message);
    cachedSheetTitle = "Sheet1";
  }

  return cachedSheetTitle;
}

router.post("/pay", async (req, res) => {
  const event = normalizeString(req.body?.event);
  const shouldProcess = !event || COMPLETION_EVENTS.has(event);
  const paymentId = normalizeString(getNested(req.body, "payload.payment.entity.id"));

  if (!shouldProcess) {
    return res.status(200).json({
      status: "ignored",
      reason: "event_not_completion",
      event: event || null,
    });
  }

  cleanupProcessedPayments();
  if (isDuplicatePayment(paymentId)) {
    return res.status(200).json({
      status: "ignored",
      reason: "duplicate_payment",
      event: event || null,
      paymentId: paymentId || null,
    });
  }

  const { fullName, age, city, phoneNumber, emailId } = extractRazorpayData(req.body || {});

  if (!fullName && !phoneNumber && !emailId) {
    return res.status(400).json({
      status: "error",
      message: "Required customer details not found in payload",
      event: event || null,
    });
  }

  const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  try {
    const sheetTitle = await resolveSheetTitle();
    const range = `${sheetTitle}!A:F`;

    const values = [[
      timestamp,
      fullName,
      age,
      city,
      phoneNumber,
      emailId,
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      resource: { values },
    });

    let emailStatus = "skipped";
    if (emailId) {
      try {
        await sendCamConfirmationEmail({ to: emailId, fullName });
        emailStatus = "sent";
      } catch (emailError) {
        emailStatus = "failed";
        console.error("[saloni cam_workshop] Email send failed:", emailError.message);
      }
    }

    return res.status(201).json({
      status: "success",
      message: "Payment data stored in Google Sheets",
      event: event || null,
      paymentId: paymentId || null,
      emailStatus,
    });
  } catch (error) {
    console.error("[saloni cam_workshop] Error writing to Google Sheets:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to store data in Google Sheets",
      error: error.message,
    });
  }
});

module.exports = router;
