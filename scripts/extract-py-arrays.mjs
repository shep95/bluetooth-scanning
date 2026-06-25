/**
 * One-time extractor: pulls Python list[dict] literals into JSON for TS import.
 * Reads .py as text — does not execute Python.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function extractArray(source, varName) {
  const re = new RegExp(`${varName}:\\s*list\\[dict\\[str,\\s*str\\]\\]\\s*=\\s*\\[`, "m");
  const m = source.match(re);
  if (!m) throw new Error(`array ${varName} not found`);
  let i = m.index + m[0].length;
  let depth = 1;
  let buf = "[";
  while (i < source.length && depth > 0) {
    const ch = source[i];
    buf += ch;
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    i++;
  }
  // Python dicts use True/False/None — normalize for JSON.parse after quote fix
  let jsonish = buf
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,\s*]/g, "]")
    .replace(/,\s*}/g, "}");
  return JSON.parse(jsonish);
}

function extractListOfDictsAny(source, varName) {
  const re = new RegExp(`${varName}:\\s*list\\[dict\\[str,\\s*Any\\]\\]\\s*=\\s*\\[`, "m");
  const m = source.match(re);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let buf = "[";
  while (i < source.length && depth > 0) {
    const ch = source[i];
    buf += ch;
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    i++;
  }
  let jsonish = buf
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,\s*]/g, "]")
    .replace(/,\s*}/g, "}");
  return JSON.parse(jsonish);
}

const theoryPy = fs.readFileSync(path.join(root, "ble_theory.py"), "utf8");
const screenPy = fs.readFileSync(path.join(root, "ble_screen_relay.py"), "utf8");
const wifiPy = fs.readFileSync(path.join(root, "ble_wifi_pose.py"), "utf8");

const out = {
  TACTICAL_THEORIES: extractArray(theoryPy, "TACTICAL_THEORIES"),
  PASSIVE_THEORIES: extractArray(theoryPy, "PASSIVE_THEORIES"),
  GATT_THEORIES: extractArray(theoryPy, "GATT_THEORIES"),
  SECURITY_THEORIES: extractArray(theoryPy, "SECURITY_THEORIES"),
  ARCHITECTURE_THEORIES: extractArray(theoryPy, "ARCHITECTURE_THEORIES"),
  SCREEN_RELAY_THEORIES: extractArray(screenPy, "SCREEN_RELAY_THEORIES"),
  WIFI_POSE_THEORIES: extractArray(wifiPy, "WIFI_POSE_THEORIES"),
};

const outDir = path.join(root, "src", "data");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "theory-arrays.json"), JSON.stringify(out, null, 2));
console.log("wrote theory-arrays.json", Object.keys(out).map((k) => `${k}:${out[k].length}`).join(", "));
