import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "tactical_hud.html"), "utf8");
const m = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
if (!m) throw new Error("no script block found");

let s = m[1];
const header = `import {
  BluetoothClient,
  type ScanSnapshot,
  type ScannedDevice,
  type TheoriesSnapshot,
  type ScreenRelaySnapshot,
  type ScenarioId,
} from "./bluetooth-client";

const client = new BluetoothClient();

`;

const replacements = [
  [
    /async function poll\(\) \{\s*const res = await fetch\("\/api\/devices"\);\s*applySnapshot\(await res\.json\(\)\);\s*\}/,
    "async function poll() { applySnapshot(await client.getDevices()); }",
  ],
  [
    /async function refreshHealth\(\) \{\s*try \{\s*const res = await fetch\("\/api\/health"\);\s*const data = await res\.json\(\);/,
    "async function refreshHealth() { try { const data = await client.checkHealth();",
  ],
  [
    /async function startScan\(\) \{\s*statusEl\.textContent = "Initiating sweep…";\s*const res = await fetch\("\/api\/scan", \{ method: "POST" \}\);\s*const data = await res\.json\(\);\s*if \(!res\.ok\) \{ statusEl\.textContent = data\.error \|\| "Sweep failed\."; await refreshHealth\(\); return; \}/,
    'async function startScan() { statusEl.textContent = "Initiating sweep…"; try { await client.triggerScan(); } catch (e) { statusEl.textContent = (e instanceof Error ? e.message : "Sweep failed."); await refreshHealth(); return; }',
  ],
  [
    /async function stopScan\(\) \{\s*await fetch\("\/api\/stop", \{ method: "POST" \}\)\.catch\(\(\) => \{\}\);/,
    "async function stopScan() { await client.stopScan().catch(() => {});",
  ],
  [
    /await fetch\("\/api\/location", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{\s*latitude: pos\.coords\.latitude,\s*longitude: pos\.coords\.longitude,\s*accuracyMeters: pos\.coords\.accuracy,\s*\}\),\s*\}\);/g,
    "await client.setScannerLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);",
  ],
  [
    /const res = await fetch\("\/api\/scan", \{ method: "POST" \}\);\s*const data = await res\.json\(\);\s*if \(res\.ok \|\| data\.alreadyRunning\) \{/,
    "try { const data = await client.triggerScan(); if (data.ok || data.alreadyRunning) {",
  ],
  [
    /async function loadScenarios\(\) \{\s*const res = await fetch\("\/api\/scenario"\);\s*const data = await res\.json\(\);/,
    "async function loadScenarios() { const data = await client.getScenarios();",
  ],
  [
    /await fetch\("\/api\/scenario", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ scenario: scenarioEl\.value \}\),\s*\}\);/,
    "await client.setScenario(scenarioEl.value as ScenarioId);",
  ],
  [
    /async function startRelaySession\(address, displayName\) \{\s*const res = await fetch\("\/api\/screen\/session", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ deviceAddress: address, label: displayName \|\| address \}\),\s*\}\);\s*const data = await res\.json\(\);\s*if \(!res\.ok\) \{\s*showToast\(data\.error \|\| "Session failed"\);\s*return;\s*\}/,
    'async function startRelaySession(address: string, displayName: string) { try { const data = await client.createScreenSession({ deviceAddress: address, label: displayName || address });',
  ],
  [/activeRelaySession = data\.session\?\.sessionId;/, "activeRelaySession = data.session?.sessionId || null;"],
  [
    /img\.src = "\/api\/screen\/frame\/latest\?session="\s*\+ encodeURIComponent\(activeRelaySession\) \+ "&t=" \+ Date\.now\(\);/,
    "img.src = client.latestScreenFrameUrl(activeRelaySession);",
  ],
  [
    /await loadScreenRelay\(address\);\s*showToast\("Scan QR on device → START SHARE"\);\s*\}/,
    'await loadScreenRelay(address); showToast("Scan QR on device → START SHARE"); } catch (e) { showToast(e instanceof Error ? e.message : "Session failed"); return; } }',
  ],
  [
    /async function loadPoseSense\(\) \{\s*try \{\s*const res = await fetch\("\/api\/wifi\/pose"\);\s*if \(!res\.ok\) return;\s*const data = await res\.json\(\);/,
    "async function loadPoseSense() { try { const data = await client.getWifiPose();",
  ],
  [
    /async function loadScreenRelay\(address\) \{\s*try \{\s*const url = address\s*\?\s*"\/api\/screen\/relay\?address=" \+ encodeURIComponent\(address\)\s*:\s*"\/api\/screen\/relay";\s*const res = await fetch\(url\);\s*if \(!res\.ok\) return;\s*renderScreenRelayPanel\(await res\.json\(\)\);/,
    "async function loadScreenRelay(address?: string) { try { renderScreenRelayPanel(await client.getScreenRelay(address));",
  ],
  [
    /replaySlider\.addEventListener\("input", async \(\) => \{\s*const res = await fetch\("\/api\/replay"\);\s*const data = await res\.json\(\);/,
    'replaySlider.addEventListener("input", async () => { const data = await client.getReplay();',
  ],
  [
    /if \(!theoryCache\) \{\s*const res = await fetch\("\/api\/theories"\);\s*theoryCache = await res\.json\(\);\s*\}/,
    "if (!theoryCache) { theoryCache = await client.getTheories(); }",
  ],
  [
    /await fetch\("\/api\/watchlist", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ address: btn\.dataset\.id, action: "toggle" \}\),\s*\}\);/,
    "await client.toggleWatchlist(btn.dataset.id!);",
  ],
  [
    /const res = await fetch\("\/api\/pull", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ address: btn\.dataset\.id \}\),\s*\}\);\s*const data = await res\.json\(\);\s*if \(!res\.ok\) showToast\(data\.error \|\| "Pull failed"\);\s*else showToast\(`GATT pull · tier \$\{data\.exfilTier \|\| "\?"\}`\);/,
    'try { const data = await client.pullDeviceData(btn.dataset.id!); showToast(`GATT pull · tier ${data.exfilTier || "?"}`); } catch (e) { showToast(e instanceof Error ? e.message : "Pull failed"); }',
  ],
  [
    /const res = await fetch\("\/api\/dossier\?address=" \+ encodeURIComponent\(id\)\);\s*const dossier = await res\.json\(\);/,
    "const dossier = await client.getDossier(id);",
  ],
  [
    /if \(pw\) window\.location\.href = "\/api\/extract\?format=cipher&password=" \+ encodeURIComponent\(pw\);\s*\} else \{\s*window\.location\.href = "\/api\/extract\?format=zip";\s*\}/,
    'if (pw) window.location.href = client.extractionUrl("cipher", pw); } else { window.location.href = client.extractionUrl("zip"); }',
  ],
  [
    /briefBtn\.addEventListener\("click", \(\) => \{ window\.open\("\/api\/brief", "_blank"\); \}\);/,
    'briefBtn.addEventListener("click", () => { window.open(client.briefUrl(), "_blank"); });',
  ],
  [
    /else if \(cmd\.includes\("brief"\)\) \{ window\.open\("\/api\/brief", "_blank"\); \}/,
    'else if (cmd.includes("brief")) { window.open(client.briefUrl(), "_blank"); }',
  ],
  [
    /function connectSSE\(\) \{\s*const es = new EventSource\("\/api\/events\/stream"\);\s*es\.onopen = \(\) => \{ sseStatus\.textContent = "● War room link ACTIVE"; \};\s*es\.onmessage = \(ev\) => \{\s*try \{\s*const e = JSON\.parse\(ev\.data\);\s*tickerEl\.textContent = e\.message;\s*\} catch \(_\) \{\}\s*\};/,
    'function connectSSE() { const es = client.openWarRoomStream((e) => { tickerEl.textContent = e.message; }); es.onopen = () => { sseStatus.textContent = "● War room link ACTIVE"; };',
  ],
  [/function applySnapshot\(data\) \{/, "function applySnapshot(data: ScanSnapshot) {"],
  [/function renderDevices\(devices\) \{/, "function renderDevices(devices: ScannedDevice[]) {"],
  [/let theoryCache = null;/, "let theoryCache: TheoriesSnapshot | null = null;"],
  [/function renderScreenRelayPanel\(relay\) \{/, "function renderScreenRelayPanel(relay: ScreenRelaySnapshot) {"],
];

for (const [from, to] of replacements) {
  s = s.replace(from, to);
}

// Close bootSweep try/catch for triggerScan
s = s.replace(
  /await poll\(\);\s*\}\s*, \(\) => \{\}, \{ enableHighAccuracy: true, timeout: 12000 \}\);\s*\}\s*try \{ const data = await client\.triggerScan\(\); if \(data\.ok \|\| data\.alreadyRunning\) \{/,
  "await poll(); }, () => {}, { enableHighAccuracy: true, timeout: 12000 }); } try { const data = await client.triggerScan(); if (data.ok || data.alreadyRunning) {",
);

// Add catch for bootSweep scan trigger
s = s.replace(
  /if \(data\.ok \|\| data\.alreadyRunning\) \{\s*playBlip\(220, 0\.15\);\s*stopBtn\.disabled = false;\s*\}\s*await poll\(\);\s*\}/,
  "if (data.ok || data.alreadyRunning) { playBlip(220, 0.15); stopBtn.disabled = false; } } catch (_) {} await poll(); }",
);

const out = path.join(root, "tactical-hud.ts");
fs.writeFileSync(out, header + s);
console.log("wrote", out, (header + s).length, "bytes");
