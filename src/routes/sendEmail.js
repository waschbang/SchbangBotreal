const express = require("express");
const nodemailer = require("nodemailer");
const router = express.Router();

// Configure the email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "karanvishwakarma732@gmail.com",
    pass: "auittoxwfuzrngud",
  },
});

const FORM_LINKS = {
  tech:
    "https://docs.google.com/forms/d/1AqUYk4vpKfyFExiptTYau3tZ-eAr2LDdKNjj1Ci3jUs/edit",
  brandSolutions:
    "https://docs.google.com/forms/d/1Ni0e_9qxNgIvF39dKhJny_UTughp_DVCT0W7ZquMgtk/edit",
  media:
    "https://docs.google.com/forms/d/1X3BuSLjmDtLkZy6qxDKCo0wgVt9_7fDgYoMaLx0MgR0/edit",
};

// POST route to send an email
router.post("/", async (req, res) => {
  try {
    const { email, services } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).send("Email is required.");
    }

    if (!services || typeof services !== "object") {
      return res.status(400).send("Services object is required.");
    }

    // Determine which forms to send based on services
    const pendingForms = [];
    if (services.tech) pendingForms.push("tech");
    if (services.solutions) pendingForms.push("brandSolutions");
    if (services.media) pendingForms.push("media");

    if (pendingForms.length === 0) {
      return res
        .status(400)
        .send("No applicable forms found for the user's services.");
    }

    // Create form links HTML based on pending forms
    const formLinksHtml = pendingForms
      .map((form) => {
        const formName =
          form === "brandSolutions"
            ? "Brand Solutions"
            : form.charAt(0).toUpperCase() + form.slice(1);
        return `
          <div style="text-align: center; margin: 25px 0;">
            <a href="${FORM_LINKS[form]}" 
               style="background-color: #2196F3; 
                      color: white; 
                      padding: 14px 28px; 
                      text-decoration: none; 
                      border-radius: 4px; 
                      font-weight: bold;
                      display: inline-block;
                      min-width: 200px;
                      transition: background-color 0.3s ease;
                      box-shadow: 0 2px 4px rgba(33, 150, 243, 0.2);">
              ${formName} Feedback Form
            </a>
          </div>
        `;
      })
      .join("");

    const mailOptions = {
      from: '"Schbang Partner Buddy" <karanvishwakarma732@gmail.com>',
      to: email,
      subject: "Share Your Feedback with Schbang",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Schbang Feedback Request</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; line-height: 1.6; background-color: #f5f5f5;">
            <div style="max-width: 600px; margin: 20px auto; padding: 30px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 35px;">
                <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=600&q=80" 
                     alt="Schbang" 
                     style="max-width: 180px; height: auto; border-radius: 4px;">
              </div>

              <h1 style="color: #2c3e50; font-size: 28px; margin-bottom: 25px; text-align: center; font-weight: 600;">
                We Value Your Feedback
              </h1>

              <p style="color: #34495e; margin-bottom: 20px; font-size: 16px;">
                Dear Partner,
              </p>

              <p style="color: #34495e; margin-bottom: 30px; font-size: 16px; line-height: 1.8;">
                Your opinion matters to us. Please take a moment to share your thoughts about our services 
                through our quick surveys below.
              </p>

              ${formLinksHtml}

              <div style="color: #5d6975; font-size: 15px; margin-top: 35px; padding-top: 25px; border-top: 1px solid #e8e8e8;">
                <p style="margin-bottom: 15px;">
                  Need help? Contact us at <a href="mailto:feedback@schbang.com" style="color: #2196F3; text-decoration: none; font-weight: 500;">feedback@schbang.com</a>
                </p>
                
                <p style="margin-bottom: 15px;">
                  Best regards,<br>
                  <strong>The Schbang Team</strong>
                </p>
              </div>

              <div style="text-align: center; color: #95a5a6; font-size: 13px; margin-top: 25px; padding-top: 20px; border-top: 1px solid #e8e8e8;">
                © ${new Date().getFullYear()} Schbang. All rights reserved.
              </div>
            </div>
          </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).send("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).send("Error sending email.");
  }
});

module.exports = router;
