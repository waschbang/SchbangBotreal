const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

const DEFAULT_FROM = "salonisuri@thecoach.co.in";
const DEFAULT_SUBJECT = "Abundance Workshop Registration Confirmation";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "salonisuri@thecoach.co.in",
    pass: "fimukaogpxstjjrw",
  },
});

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function getFirstName(fullName) {
  const normalized = normalizeString(fullName);
  if (!normalized) return "there";
  return normalized.split(/\s+/)[0];
}


function getSignaturePath() {
  return path.join(__dirname, "../../assets/saloni/cam_signature.jpeg");
}

function buildLetterText(firstName) {
  return [
    `Dear ${firstName},`,
    "",
    "Thank you for your registration for the workshop \"Creating An Abundance Mindset\" (CAM).",
    "Your attendance is confirmed.",
    "I am happy to have you attend and honored to bring this workshop to you. The workshop will be held on March 15th, Sunday, 2026, from 2:00 pm to 6:00 pm.",
    "Please do go over the following note, it will help you to be prepared for the workshop.",
    "Kindly also note: this workshop is non-transferable & non-refundable.",
    "",
    "Please note this workshop involves prep work that you need to do. I shall be sharing that by 13th March.",
    "Prior to workshop:",
    "1. Kindly ensure the Zoom app is installed on your laptop.",
    "2. Kindly ensure that you have a steady internet connection.",
    "3. Please do not schedule anything immediately after the class, in case we need to go a little bit over the scheduled time.",
    "",
    "March 14th (Sat) One day prior to workshop",
    "1. I shall send you the workbook by 9:00 am, please take a print out and keep it ready for use during the workshop.",
    "2. You will receive the zoom meeting joining id as well.",
    "",
    "On Day of workshop - March 15th:",
    "1. Please do join the session 10 min prior to the starting time, so that we have time to settle in with the technology.",
    "2. It is preferred that you use headphones to listen in.",
    "3. Kindly keep a pen handy and the workbook with you at all times.",
    "4. All participants are requested to keep their cameras on at all times.",
    "5. A presentation shall be in screen share mode for participants to see during the course of the workshop.",
    "6. In case there is a technical glitch, be patient and we shall try and resolve it.",
    "7. Make sure you are in a quiet place where nothing can distract you.",
    "8. Be in a comfortable position so you can fully take part in any guided meditation and visualization exercises that may be a part of the class.",
    "9. Stretch your muscles before starting the class. Stretching loosens the muscles and tendons allowing you to sit more comfortably. Additionally, stretching starts the process of \"going inward\" and brings added focus to the body.",
    "10. Be open to the experience and to the learnings you shall receive.",
    "",
    "I am looking forward to meeting you. This will be an absolutely immersive, transformational workshop, and I am excited for all of us. You will be already working on yourself during the workshop, so you won't truly be the same person when the workshop ends.",
    "",
    "See you soon,",
  ].join("\n");
}

function buildLetterHtml(firstName) {
  const text = buildLetterText(firstName);
  const lines = text.split("\n");
  const htmlLines = lines.map((line) => {
    if (!line.trim()) return "<br/>";
    return `<p style=\"margin: 0 0 12px 0;\">${line}</p>`;
  });

  return `
    <div style=\"font-family: Arial, sans-serif; font-size: 16px; color: #1f2a44; line-height: 1.6;\">
      ${htmlLines.join("\n")}
      <div style=\"margin-top: 10px;\">
        <img src=\"cid:cam-signature\" alt=\"Signature\" style=\"max-width: 220px; height: auto;\" />
      </div>
      <p style=\"margin: 8px 0 0 0;\">Saloni Suri</p>
    </div>
  `;
}

async function sendCamConfirmationEmail({ to, fullName }) {
  const recipient = normalizeString(to);
  if (!recipient) throw new Error("Recipient email is required");

  const signaturePath = getSignaturePath();
  if (!fs.existsSync(signaturePath)) {
    throw new Error(
      `Signature image not found at ${signaturePath}. Add cam_signature.jpeg.`
    );
  }

  const firstName = getFirstName(fullName);
  const fromAddress = DEFAULT_FROM;
  const subject = DEFAULT_SUBJECT;

  const html = buildLetterHtml(firstName);
  const text = buildLetterText(firstName);

  const mailOptions = {
    from: fromAddress,
    to: recipient,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "signature.jpeg",
        path: signaturePath,
        cid: "cam-signature",
      },
    ],
  };

  return transporter.sendMail(mailOptions);
}

module.exports = { sendCamConfirmationEmail };
