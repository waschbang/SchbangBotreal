const express = require("express");
const moment = require("moment-timezone");
const { getGoogleSheets } = require("../../lib/googleAuth");

const router = express.Router();

const sheets = getGoogleSheets();
const SPREADSHEET_ID = "1_7NwXpcmq_FKKHWjWAITCKva6hPpWWNTCqMy-Z1Zeg0";

let cachedSheetTitle = null;

const COMPLETION_EVENTS = new Set([
  "payment.captured",
  "payment.authorized",
  "order.paid",
  "payment_link.paid",
  "subscription.charged",
]);

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function pickFirst(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return "";
}

function getNested(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function extractRazorpayData(body) {
  const payment = getNested(body, "payload.payment.entity") || {};
  const order = getNested(body, "payload.order.entity") || {};
  const paymentLink = getNested(body, "payload.payment_link.entity") || {};
  const invoice = getNested(body, "payload.invoice.entity") || {};

  const notes =
    payment.notes ||
    order.notes ||
    paymentLink.notes ||
    invoice.notes ||
    body.notes ||
    {};

  const customerDetails =
    payment.customer_details ||
    order.customer_details ||
    paymentLink.customer ||
    invoice.customer_details ||
    {};

  const fullName = pickFirst(
    notes.full_name,
    notes.fullName,
    notes.name,
    notes.customer_name,
    customerDetails.name,
    payment.customer_name,
    payment.card && payment.card.name
  );

  const age = pickFirst(
    notes.age,
    notes.Age,
    notes.customer_age,
    notes.customerAge,
    customerDetails.age
  );

  const city = pickFirst(
    notes.city,
    notes.City,
    notes.customer_city,
    notes.customerCity,
    customerDetails.city
  );

  const phoneNumber = pickFirst(
    notes.phone,
    notes.phone_number,
    notes.phoneNumber,
    notes.mobile,
    notes.contact,
    payment.contact,
    order.contact,
    customerDetails.contact,
    paymentLink.customer && paymentLink.customer.contact
  );

  const emailId = pickFirst(
    notes.email,
    notes.email_id,
    notes.emailId,
    payment.email,
    order.email,
    customerDetails.email,
    paymentLink.customer && paymentLink.customer.email
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

  if (!shouldProcess) {
    return res.status(200).json({
      status: "ignored",
      reason: "event_not_completion",
      event: event || null,
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

    return res.status(201).json({
      status: "success",
      message: "Payment data stored in Google Sheets",
      event: event || null,
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
