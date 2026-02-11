const express = require("express");
const bodyParser = require("body-parser");
// const responseRoute = require("./routes/response");
const trainingRoute = require("./routes/training");
const userDetailsRoute = require("./routes/userDetails");
const checkIdRoute = require("./routes/checkId");
const getBrandInfoRoute = require("./routes/getBrandInfo");
const sendEmailRoute = require("./routes/sendEmail");
// const askGPTRoute = require("./routes/askGPT");
const csatAverageRoute = require("./routes/csatAverage"); // Import the CSAT average rout
const getMainDataRoute = require("./routes/getMainData"); // Import the Main sheet data route
// const storeDataRoute = require("./routes/storeData"); // Import the storeData route
// const sendanyRoute = require("./routes/sendany"); // Import the sendany route
const pdpResponseRoute = require("./routes/PdpResponse"); // Import the PDP response route
const markFilledRoute = require("./routes/markFilled"); // Import the markFilled route
const markServiceFilledRoute = require("./routes/markServiceFilled"); // Import the markServiceFilled route
const addOtherDataRoute = require("./routes/addotherdata"); // Import the addotherdata route
const logBodyRoute = require("./routes/logBody");
const tshirtTryOnRoute = require("./routes/tshirtTryOn");
const skinCareSuggestionRoute = require("./routes/skinCareSuggestion");
// const genaibotRoute = require("./routes/genaibot");
const copyFeedbackRoute = require("./routes/copyFeedback");
const camWorkshopPayRoute = require("./routes/saloni/camWorkshopPay");
//real genai
// const genaiRoute = require("./routes/genai");
const aiCallingRoute = require("./routes/aicalling"); // AiSensy call webhook
const app = express();
const DEFAULT_PORT = 3000;
let PORT = process.env.PORT || DEFAULT_PORT;

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Add CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    return res.status(200).json({});
  }
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);

  try {
    const body = req.body || {};
  } catch (e) {
    // Do not block request flow on logging errors
  }

  next();
});

// app.use("/api/response", responseRoute);
app.use("/api/copyFeedback", copyFeedbackRoute);
app.use("/api/training", trainingRoute);
app.use("/api/userDetails", userDetailsRoute);
app.use("/api/check-id", checkIdRoute);
app.use("/api/getBrandInfo", getBrandInfoRoute);
app.use("/api/sendEmail", sendEmailRoute);
// app.use("/askgpt", askGPTRoute);
app.use("/api/addotherdata", addOtherDataRoute); // Register the new route
app.use("/api/csatAverage", csatAverageRoute); // Register the CSAT average route
app.use("/api/getMainData", getMainDataRoute); // Register the Main sheet data route
// app.use("/api/storeData", storeDataRoute); // Register the storeData route
// app.use("/api/sendany", sendanyRoute); // Register the sendany route
app.use("/api/image", logBodyRoute);
app.use("/api/tshirt-tryon", tshirtTryOnRoute);
app.use("/api/skincare-suggestion", skinCareSuggestionRoute);
app.use("/api/pdp", pdpResponseRoute); // Register the PDP response route
app.use("/api/markFilled", markFilledRoute); // Register the markFilled route
app.use("/api/markServiceFilled", markServiceFilledRoute); // Register the markServiceFilled route
app.use("/salonibackend/api/cam_workshop", camWorkshopPayRoute);
// app.use("/api/genaibot", genaibotRoute); // Register the genaibot route
app.use("/webhook/aisensy", aiCallingRoute); // Register AiSensy webhook at /webhook/aisensy
//real genai
// app.use("/api/genai", genaiRoute); // Register the genai route
/**
 * POST /api/pdp/incoming-message
 * Body: { phoneNumber: string, message: string, userName?: string }
 * Description: Instantly process a new incoming message and trigger product assistance logic.
 * Example:
 *   fetch('/api/pdp/incoming-message', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *   })
 *   .then(res => res.json())
 *   .then(console.log);
 */


// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res
    .status(500)
    .json({ message: "Internal server error", error: err.message });
});

// Function to start the server with port fallback
const startServer = (port) => {
  const server = app
    .listen(port)
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} is busy, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    })
    .on("listening", () => {
      PORT = server.address().port;
      console.log(`Server is running on port ${PORT}`);
    });
};

// Start the server with fallback options
startServer(PORT);
