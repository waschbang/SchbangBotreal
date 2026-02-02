// Test new client brief detection
const testBriefDetection = (message) => {
  const msgLower = message.toLowerCase();
  return (
    msgLower.includes("brief") ||
    (msgLower.includes("new") && msgLower.includes("client")) ||
    (msgLower.includes("want") && msgLower.includes("client")) ||
    (msgLower.includes("submit") &&
      (msgLower.includes("brief") || msgLower.includes("project")))
  );
};

// Test cases
const testMessages = [
  "I want to submit a brief",
  "fill a brief",
  "new client here",
  "want to be a client",
  "submit project brief",
  "I want to fill csat",
  "hello there",
  "brief form",
  "client brief",
  "submit a brief",
];

console.log("Testing new client brief detection:");
testMessages.forEach((msg) => {
  const result = testBriefDetection(msg);
  console.log(`"${msg}" -> isNewClientBrief: ${result}`);
});
