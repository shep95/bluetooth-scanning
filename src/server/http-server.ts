/** HTTP API + static HUD — TypeScript port of ble-scan-server.py routes. */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

import { formatMac, normalizeMac } from "../ble/device-naming.js";
import { FRAME_STORE, lanIp, relayUrls } from "../ble/frame-store.js";
import { HOP_GRAPH } from "../ble/hop-graph.js";
import { pullDeviceDataSync } from "../ble/gatt-pull.js";
import { SCANNER_LOCATION, reverseGeocode } from "../ble/location.js";
import { securitySummary, theorySnapshot } from "../ble/theory.js";
import { SCI_FI, generateMissionBrief } from "../engine/sci-fi.js";
import { screenRelaySnapshot } from "../engine/screen-relay.js";
import { posesenseSnapshot } from "../engine/wifi-pose.js";
import { SCENARIOS, TACTICAL } from "../engine/tactical.js";
import { checkBluetoothReady, ensureScanLoop } from "./scanner.js";
import { PERSISTENT_SCAN, STATE } from "./scan-state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HTML = readFileSync(join(ROOT, "tactical_hud.html"), "utf8");
const RELAY_HTML = readFileSync(join(ROOT, "screen_relay.html"), "utf8");
const DIST_DIR = join(ROOT, "dist");

export const PORT = Number(process.env.BLE_PORT ?? 8765);
export const BIND_ALL = ["1", "true", "yes"].includes(
  (process.env.BLE_BIND_ALL ?? "").trim().toLowerCase(),
);

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, code: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: ServerResponse, code: number, text: string, contentType: string): void {
  const body = Buffer.from(text, "utf8");
  res.writeHead(code, { "Content-Type": contentType, "Content-Length": body.length });
  res.end(body);
}

function serveDist(pathname: string, res: ServerResponse): boolean {
  if (!pathname.startsWith("/dist/")) return false;
  const rel = pathname.slice("/dist/".length);
  if (!rel || rel.includes("..")) {
    res.writeHead(403);
    res.end();
    return true;
  }
  try {
    const filePath = join(DIST_DIR, rel);
    const body = readFileSync(filePath);
    const ct = rel.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : rel.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct, "Content-Length": body.length, "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
  return true;
}

async function handleGet(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): Promise<void> {
  const qs = new URLSearchParams(search);

  if (["/", "/ble-scan.html", "/tactical_hud.html", "/index.html", "/hud"].includes(pathname)) {
    sendText(res, 200, HTML, "text/html; charset=utf-8");
    return;
  }
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (serveDist(pathname, res)) return;
  if (pathname === "/relay" || pathname === "/relay.html") {
    sendText(res, 200, RELAY_HTML, "text/html; charset=utf-8");
    return;
  }
  if (pathname === "/api/screen/sessions") {
    sendJson(res, 200, FRAME_STORE.snapshot());
    return;
  }
  if (pathname === "/api/screen/frame/latest") {
    const sessionId = qs.get("session") ?? "";
    if (!sessionId) {
      sendJson(res, 400, { error: "session query param required" });
      return;
    }
    const [jpeg, session] = FRAME_STORE.latestJpeg(sessionId);
    if (!jpeg) {
      sendJson(res, 404, {
        error: "no frame yet",
        session: session?.toDict() ?? null,
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Length": jpeg.length,
    });
    res.end(jpeg);
    return;
  }
  if (pathname === "/api/health") {
    sendJson(res, 200, await checkBluetoothReady());
    return;
  }
  if (pathname === "/api/devices") {
    sendJson(res, 200, STATE.snapshot());
    return;
  }
  if (pathname === "/api/location") {
    sendJson(res, 200, SCANNER_LOCATION.snapshot());
    return;
  }
  if (pathname === "/api/hop/graph") {
    sendJson(res, 200, HOP_GRAPH.snapshot());
    return;
  }
  if (pathname === "/api/tactical") {
    const snap = STATE.snapshot();
    sendJson(res, 200, (snap.tactical as Record<string, unknown>) ?? {});
    return;
  }
  if (pathname === "/api/chrono") {
    const snap = STATE.snapshot();
    const tac = (snap.tactical as Record<string, unknown>) ?? {};
    sendJson(res, 200, { events: tac.chrono ?? [] });
    return;
  }
  if (pathname === "/api/theories") {
    const snap = theorySnapshot();
    const devices = (STATE.snapshot().devices as Record<string, unknown>[]) ?? [];
    snap.securitySummary = securitySummary(devices);
    sendJson(res, 200, snap);
    return;
  }
  if (pathname === "/api/screen/relay") {
    const address = qs.get("address") ?? "";
    let device: Record<string, unknown> | null = null;
    if (address) {
      const snap = STATE.snapshot();
      device =
        ((snap.devices as Record<string, unknown>[]) ?? []).find(
          (d) => formatMac(String(d.id ?? "")) === formatMac(address),
        ) ?? null;
    }
    const payload = screenRelaySnapshot(device);
    payload.bindAll = BIND_ALL;
    payload.lanIp = lanIp();
    payload.frameStore = FRAME_STORE.snapshot();
    sendJson(res, 200, payload);
    return;
  }
  if (pathname === "/api/wifi/pose") {
    const address = qs.get("address") ?? "";
    const snap = STATE.snapshot();
    let device: Record<string, unknown> | null = null;
    if (address) {
      device =
        ((snap.devices as Record<string, unknown>[]) ?? []).find(
          (d) => formatMac(String(d.id ?? "")) === formatMac(address),
        ) ?? null;
    }
    sendJson(res, 200, posesenseSnapshot(device, snap.hopGraph as Record<string, unknown>));
    return;
  }
  if (pathname === "/api/brief") {
    const snap = STATE.snapshot();
    const brief = generateMissionBrief(snap);
    sendText(res, 200, brief, "text/plain; charset=utf-8");
    return;
  }
  if (pathname === "/api/replay") {
    const snap = STATE.snapshot();
    const tac = (snap.tactical as Record<string, unknown>) ?? {};
    const sciFi = (tac.sciFi as Record<string, unknown>) ?? {};
    sendJson(res, 200, { frames: sciFi.replayFrames ?? [] });
    return;
  }
  if (pathname === "/api/scenario") {
    sendJson(res, 200, {
      active: TACTICAL.getScenarioId(),
      scenarios: Object.entries(SCENARIOS).map(([id, v]) => {
        const { autoPullMax: _a, ...rest } = v;
        return { id, ...rest };
      }),
    });
    return;
  }
  if (pathname === "/api/dossier") {
    const address = qs.get("address") ?? "";
    if (!address) {
      sendJson(res, 400, { error: "address query param required" });
      return;
    }
    const snap = STATE.snapshot();
    const device =
      ((snap.devices as Record<string, unknown>[]) ?? []).find(
        (d) => formatMac(String(d.id ?? "")) === formatMac(address),
      ) ?? null;
    if (!device) {
      sendJson(res, 404, { error: "Device not found" });
      return;
    }
    sendJson(res, 200, TACTICAL.buildDossier(device, snap.hopGraph as Record<string, unknown>));
    return;
  }
  if (pathname === "/api/extract") {
    const fmt = qs.get("format") ?? "json";
    const password = qs.get("password") ?? "";
    const snap = STATE.snapshot();
    const pkg = TACTICAL.buildExtractionPackage(snap, snap.hopGraph as Record<string, unknown>);
    if (fmt === "cipher" && password) {
      const body = TACTICAL.buildCipherExfil(pkg, password);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="houseofasher_cipher.zip"',
        "Content-Length": body.length,
      });
      res.end(body);
      return;
    }
    if (fmt === "zip") {
      const body = TACTICAL.buildExtractionZip(pkg);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="houseofasher_intel.zip"',
        "Content-Length": body.length,
      });
      res.end(body);
      return;
    }
    sendJson(res, 200, pkg);
    return;
  }
  if (pathname === "/api/events/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const sub = TACTICAL.subscribeSse();
    res.write(`data: ${JSON.stringify({ type: "link", message: "WAR ROOM LINK ESTABLISHED" })}\n\n`);
    const timer = setInterval(() => {
      if (sub.length > 0) {
        const msg = sub.shift()!;
        res.write(`data: ${msg}\n\n`);
      } else {
        res.write(": keepalive\n\n");
      }
    }, 500);
    req.on("close", () => {
      clearInterval(timer);
      TACTICAL.unsubscribeSse(sub);
    });
    return;
  }
  res.writeHead(404);
  res.end();
}

async function handlePost(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const payload = await readJson(req);

  if (pathname === "/api/screen/frame") {
    const sessionId = String(payload.sessionId ?? "").trim();
    const frameB64 = (payload.frameJpeg ?? payload.frame) as string | undefined;
    if (!sessionId || !frameB64) {
      sendJson(res, 400, { error: "sessionId and frameJpeg required" });
      return;
    }
    let jpeg: Buffer;
    try {
      jpeg = Buffer.from(frameB64, "base64");
    } catch {
      sendJson(res, 400, { error: "invalid base64 frame" });
      return;
    }
    const addr = payload.deviceAddress;
    const result = FRAME_STORE.ingestFrame(
      sessionId,
      jpeg,
      payload.width as number | undefined,
      payload.height as number | undefined,
      addr ? formatMac(String(addr)) : undefined,
    );
    if (result.ok) {
      const label = payload.label ?? sessionId;
      TACTICAL.log("relay", `SCREEN FRAME · ${label} · #${result.frameCount}`, {
        sessionId,
        mac: addr,
      });
    }
    sendJson(res, result.ok ? 200 : 404, result);
    return;
  }
  if (pathname === "/api/wifi/pose") {
    TACTICAL.log(
      "pose",
      `POSE INGEST · ${payload.subjectLabel ?? "track"} · spec accept`,
      { nodeId: payload.nodeId, keys: ((payload.keypoints as unknown[]) ?? []).length },
    );
    sendJson(res, 200, {
      ok: true,
      accepted: true,
      note: "CSI pose ingest spec — HUD overlay planned; BLE fusion via recommendPoseFusion",
      payload,
    });
    return;
  }
  if (pathname === "/api/screen/session") {
    const addr = payload.deviceAddress;
    const label = payload.label ?? "Screen relay";
    const session = FRAME_STORE.createSession(
      addr ? formatMac(String(addr)) : undefined,
      String(label),
    );
    const urls = relayUrls(session.sessionId, PORT, BIND_ALL);
    let relayPage = urls.relayPage;
    if (addr) {
      relayPage += `&address=${encodeURIComponent(formatMac(String(addr)))}&label=${encodeURIComponent(String(label))}`;
    }
    sendJson(res, 200, {
      ok: true,
      session: session.toDict(),
      urls: { ...urls, relayPage },
      bindAll: BIND_ALL,
      lanIp: lanIp(),
      phoneNote: BIND_ALL
        ? "Open relay URL on phone — same Wi‑Fi as this PC"
        : "Phone on Wi‑Fi can open relay URL when server started with BLE_BIND_ALL=1",
    });
    return;
  }
  if (pathname === "/api/hop/report") {
    try {
      HOP_GRAPH.registerScannerReport(payload);
      const nodeId = String(payload.nodeId ?? "");
      if (payload.listeningPost && nodeId) {
        SCI_FI.registerListeningPost(nodeId);
        TACTICAL.log("deaddrop", `LISTENING POST online · ${payload.nodeLabel ?? nodeId}`, { nodeId });
      }
      const obsCount = ((payload.observations as unknown[]) ?? []).length;
      TACTICAL.log(
        "hop",
        `HOP INGEST · ${payload.nodeLabel ?? nodeId} → ${obsCount} device(s) to root map`,
        { nodeId, observations: obsCount },
      );
      sendJson(res, 200, { ok: true, hopGraph: HOP_GRAPH.snapshot() });
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (pathname === "/api/location") {
    const lat = payload.latitude;
    const lon = payload.longitude;
    if (lat == null || lon == null) {
      sendJson(res, 400, { error: "latitude and longitude required" });
      return;
    }
    SCANNER_LOCATION.setCoords(
      Number(lat),
      Number(lon),
      payload.accuracyMeters as number | undefined,
      String(payload.source ?? "browser"),
    );
    try {
      const [full, short] = await reverseGeocode(Number(lat), Number(lon));
      SCANNER_LOCATION.setAddress(full, short);
      sendJson(res, 200, { ...SCANNER_LOCATION.snapshot(), message: "Location updated" });
    } catch (e) {
      sendJson(res, 200, {
        ...SCANNER_LOCATION.snapshot(),
        message: `Coords saved; address lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    STATE.applyResolvedRecords();
    return;
  }
  if (pathname === "/api/pull") {
    const address = payload.address;
    if (!address) {
      sendJson(res, 400, { error: "address required" });
      return;
    }
    if (!STATE.hasDevice(String(address))) {
      sendJson(res, 404, { error: "Device not in last scan — scan first" });
      return;
    }
    const result = pullDeviceDataSync(String(address));
    STATE.setPulledData(String(address), result);
    sendJson(res, 200, result);
    return;
  }
  if (pathname === "/api/stop") {
    STATE.requestSync();
    sendJson(res, 200, {
      ok: true,
      persistent: PERSISTENT_SCAN,
      message: "Hop sync queued — sweep continues",
    });
    return;
  }
  if (pathname === "/api/scenario") {
    try {
      const active = TACTICAL.setScenario(String(payload.scenario ?? "standard"));
      sendJson(res, 200, { ok: true, scenario: active });
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (pathname === "/api/watchlist") {
    const address = payload.address;
    if (!address) {
      sendJson(res, 400, { error: "address required" });
      return;
    }
    const action = payload.action ?? "add";
    const nmac = normalizeMac(String(address));
    if (action === "toggle") {
      if (TACTICAL.isOnWatchlist(String(address))) TACTICAL.removeWatchlist(String(address));
      else TACTICAL.addWatchlist(String(address));
    } else if (action === "remove") {
      TACTICAL.removeWatchlist(String(address));
    } else {
      TACTICAL.addWatchlist(String(address));
    }
    sendJson(res, 200, { ok: true, watchlist: TACTICAL.getWatchlist() });
    return;
  }
  if (pathname === "/api/scan") {
    const snap = STATE.snapshot();
    if (["running", "resolving", "pulling"].includes(String(snap.phase))) {
      sendJson(res, 200, {
        ok: true,
        continuous: true,
        persistent: PERSISTENT_SCAN,
        alreadyRunning: true,
      });
      return;
    }
    const ready = await checkBluetoothReady();
    if (!ready.ready) {
      sendJson(res, 503, { error: ready.message, reason: ready.reason });
      return;
    }
    ensureScanLoop();
    sendJson(res, 200, { ok: true, continuous: true, persistent: PERSISTENT_SCAN });
    return;
  }
  res.writeHead(404);
  res.end();
}

export function createBleServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET") {
        await handleGet(req, res, url.pathname, url.search);
      } else if (req.method === "POST") {
        await handlePost(req, res, url.pathname);
      } else {
        res.writeHead(405);
        res.end();
      }
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}
