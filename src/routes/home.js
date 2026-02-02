const express = require("express");
const router = express.Router();

// Route for the root path - redirect to dashboard
router.get("/", (req, res) => {
  // res.redirect("/dashboard");
  console.log("Home route hit successfully");
  res.send("Home route hit successfully");
});
// abc
module.exports = router;
