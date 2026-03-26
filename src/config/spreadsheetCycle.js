// Maintain spreadsheet IDs per cycle in order (oldest -> newest)
// Add new IDs to the end of the array when a new cycle starts.

const SHEET_IDS = [
  // Older -> Newer
  // Previous (old) cycle
  "14_CTezwaYLLkhWX3hskm61zXp0sfrCDnIu7bsfZt36w",
  // Current (new) cycle
  "1r3yab4vRj1GzwM7u2zmKkfiUmMMQa50rfMBaxsLF-2M",
];

function getActiveSpreadsheetId() {
  return SHEET_IDS[SHEET_IDS.length - 1];
}

function getPreviousSpreadsheetId() {
  return SHEET_IDS.length > 1 ? SHEET_IDS[SHEET_IDS.length - 2] : null;
}

module.exports = { SHEET_IDS, getActiveSpreadsheetId, getPreviousSpreadsheetId };
