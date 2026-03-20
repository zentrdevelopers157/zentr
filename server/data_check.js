// No need for a script, I can just check the /admin/stats endpoint with curl if I had a token.
// But I can run a node script that matches the index.js logic.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, "..", "data");
const SELLERS_FILE = path.join(DATA_DIR, "sellers.json");

function readJson(file, fallback) {
  try {
    const r = fs.readFileSync(file, "utf8").trim();
    return r ? JSON.parse(r) : fallback;
  } catch (e) {
    return fallback;
  }
}

const sellers = readJson(SELLERS_FILE, {});
console.log("Sellers Count:", Object.keys(sellers).length);
console.log("Sellers IDs:", Object.keys(sellers));
