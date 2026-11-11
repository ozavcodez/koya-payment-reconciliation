// Payment reconciliation.
//
// Reads payments.jsonl and works out how much money we actually collected.
// Run:  node reconcile.js

const fs = require("fs");

// Parse a timestamp into epoch milliseconds (UTC). Returns NaN if unusable.
function parseTs(ts) {
  if (typeof ts === "number") {
    // Heuristic: epoch seconds vs milliseconds
    return ts < 1e11 ? ts * 1000 : ts;
  }
  if (typeof ts !== "string") return NaN;
  let s = ts.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n < 1e11 ? n * 1000 : n;
  }
  // Treat timestamps with no timezone as UTC
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  }
  return Date.parse(s);
}

// Parse an amount into kobo (integer) to avoid floating point drift.
function parseAmountKobo(amount) {
  if (typeof amount === "number") return Math.round(amount * 100);
  if (typeof amount === "string") {
    const cleaned = amount.replace(/[₦,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  return 0;
}

// Strip BOM, split on \n or \r\n
const raw = fs.readFileSync("payments.jsonl", "utf8").replace(/^\uFEFF/, "");
const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

// txn_id -> { ts, order, event }  (latest attempt wins)
const latest = new Map();

lines.forEach((line, order) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch (e) {
    return; // unreadable line: ignore
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) return;

  if (event.txn_id === undefined || event.txn_id === null) return;
  const id = String(event.txn_id).trim();
  if (id === "") return; // no usable txn_id

  let ts = parseTs(event.ts);
  if (Number.isNaN(ts)) ts = -Infinity; // unknown time loses to any known time

  const prev = latest.get(id);
  // Later timestamp wins; on a tie, the line that appears later in the file wins
  if (!prev || ts > prev.ts || (ts === prev.ts && order > prev.order)) {
    latest.set(id, { ts, order, event });
  }
});

let totalKobo = 0;
let count = 0;

for (const { event } of latest.values()) {
  const status = String(event.status).trim().toLowerCase();
  if (status === "success") {
    totalKobo += parseAmountKobo(event.amount);
    count += 1;
  }
}

const total = totalKobo / 100;

const expected = parseInt(fs.readFileSync("expected.txt", "utf8").trim(), 10);

if (count !== expected) {
  console.log(`Check failed: counted ${count} successful payments, expected ${expected}.`);
  console.log("Something in the data isn't being handled the way the README describes.");
} else {
  console.log(`Check passed: ${count} successful payments.`);
  console.log(`Your code: KOYA-${Math.round(total)}`);
}