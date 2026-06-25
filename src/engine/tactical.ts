/** Sci-fi tactical layer — chrono log, fingerprints, trails, watchlist, scenarios, extraction. */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import {
  type DeviceSignals,
  formatMac,
  normalizeMac,
} from "../ble/device-naming.js";
import { SCI_FI, generateMissionBrief, buildCipherZip } from "./sci-fi.js";
import { recommendRelayPath } from "./screen-relay.js";

export type MissionPhase =
  | "idle"
  | "running"
  | "resolving"
  | "pulling"
  | "completed"
  | "failed";
export type ThreatTier =
  | "friendly"
  | "known"
  | "unknown"
  | "priority"
  | "breach";
export type MovementTrend = "approaching" | "receding" | "static" | "unknown";
export type InterferenceLevel = "clear" | "elevated" | "critical";
export type ScenarioId =
  | "standard"
  | "perimeter"
  | "asset_recovery"
  | "silent_observe"
  | "deep_pull";

export interface ScenarioConfig {
  label: string;
  description: string;
  autoPullMax: number;
  gattOnStop: boolean;
  proximityAlertRssi: number;
  audioEnabled: boolean;
  watchlistOnlyAlerts?: boolean;
}

export interface TrailPoint {
  ts: number;
  rssi: number | null | undefined;
  distanceMeters?: number | null;
}

export interface ChronoEventDict {
  ts: number;
  tsMs: number;
  type: string;
  message: string;
  details: Record<string, unknown>;
}

export interface InterferenceResult {
  level: InterferenceLevel;
  label: string;
  score: number;
  samples?: number;
}

export interface TriangulationObservation {
  scanner: unknown;
  scannerId: unknown;
  rssi: number;
  hopDepth: number;
}

export interface TriangulationResult {
  method: string;
  scannerCount: number;
  estimatedMeters: number;
  confidence: "high" | "medium" | "low";
  note: string;
  observations: TriangulationObservation[];
}

export interface HopGraph {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  scanners?: Array<Record<string, unknown>>;
  chains?: Array<Record<string, unknown>>;
  maxHopDepth?: number;
  nodeCount?: number;
}

export interface DeviceRecord extends Record<string, unknown> {
  displayName?: string;
  macAddress?: string;
  id?: string;
  nameSource?: string;
  proximityZone?: string;
  distanceMeters?: number | null;
  threatTier?: ThreatTier;
  movementTrend?: MovementTrend;
  hopDepth?: number | null;
  fingerprint?: string;
  passiveIntel?: unknown;
  exfilTier?: string;
  intelSummary?: unknown;
  charLabels?: unknown;
  gattAtlas?: unknown;
  pullStatus?: unknown;
  pulledData?: unknown;
  theories?: unknown[];
  triangulation?: { observations?: TriangulationObservation[] };
}

export interface OnDeviceUpdateResult {
  threatTier: ThreatTier;
  fingerprint: string;
  movementTrend: MovementTrend;
  onWatchlist: boolean;
  ghostTrail: TrailPoint[];
  knownEmitter: boolean;
  sciFi: Record<string, unknown>;
}

export interface TacticalSnapshot {
  brand: string;
  missionId: string;
  missionPhase: string;
  missionLabel: string;
  scenario: ScenarioConfig & { id: ScenarioId };
  interference: InterferenceResult;
  chrono: ChronoEventDict[];
  alerts: Record<string, unknown>[];
  watchlist: string[];
  fingerprintCount: number;
  relayScores: RelayScore[];
  dominoBreaches: DominoBreachChain[];
  ticker: string;
  sciFi: Record<string, unknown>;
}

export interface RelayScore {
  nodeId: string;
  label: string;
  contacts: number;
  bridges: number;
  score: number;
  uptime: string;
}

export interface DominoBreachChain extends Record<string, unknown> {
  hopDepth?: number;
  estimatedReachMeters?: number;
  breachLabel?: string;
}

const MISSION_PHASE_LABELS: Record<string, string> = {
  idle: "STANDBY",
  running: "SWEEP",
  resolving: "DECRYPT",
  pulling: "EXFIL",
  completed: "MISSION COMPLETE",
  failed: "SIGNAL LOST",
};

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  standard: {
    label: "Standard sweep",
    description: "Balanced discovery, name resolve, and GATT pull on stop.",
    autoPullMax: 10,
    gattOnStop: true,
    proximityAlertRssi: -65,
    audioEnabled: true,
  },
  perimeter: {
    label: "Perimeter watch",
    description: "Aggressive proximity alerts; lighter GATT exfil.",
    autoPullMax: 3,
    gattOnStop: false,
    proximityAlertRssi: -55,
    audioEnabled: true,
  },
  asset_recovery: {
    label: "Asset recovery",
    description: "Watchlist-only alerts; deep pull on known targets.",
    autoPullMax: 15,
    gattOnStop: true,
    proximityAlertRssi: -70,
    watchlistOnlyAlerts: true,
    audioEnabled: true,
  },
  silent_observe: {
    label: "Silent observe",
    description: "Passive sweep only — no GATT connect, no audio.",
    autoPullMax: 0,
    gattOnStop: false,
    proximityAlertRssi: -60,
    audioEnabled: false,
  },
  deep_pull: {
    label: "Deep exfil",
    description: "Maximum GATT intelligence pull after stop.",
    autoPullMax: 20,
    gattOnStop: true,
    proximityAlertRssi: -65,
    audioEnabled: true,
  },
};

const TRAIL_MAX_POINTS = 60;
const CHRONO_MAX_EVENTS = 500;
const INTERFERENCE_WINDOW = 20;

type SseSubscriber = string[];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function jsonStringify(value: unknown, indent?: number): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
        return Buffer.from(v).toString("base64");
      }
      return v;
    },
    indent,
  );
}

function createZip(entries: { name: string; data: string | Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const content =
      typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const useStored = compressed.length >= content.length;
    const payload = useStored ? content : compressed;
    const method = useStored ? 0 : 8;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(method, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, payload);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDir, eocd]);
}

function appendMax<T>(arr: T[], item: T, maxLen: number): void {
  arr.push(item);
  if (arr.length > maxLen) {
    arr.splice(0, arr.length - maxLen);
  }
}

function withLock<T>(fn: () => T): T {
  return fn();
}

export function missionLabel(phase: string): string {
  return MISSION_PHASE_LABELS[phase] ?? phase.toUpperCase();
}

export function threatTier(
  nameSource: string,
  proximityZone: string,
  onWatchlist: boolean,
  hopDepth?: number | null,
): ThreatTier {
  if (onWatchlist) return "priority";
  if (hopDepth != null && hopDepth >= 3) return "breach";
  if (nameSource === "paired" || nameSource === "broadcast") {
    return proximityZone === "immediate" ? "friendly" : "known";
  }
  if (nameSource === "gatt" || nameSource === "inferred") return "known";
  if (proximityZone === "immediate") return "unknown";
  return "unknown";
}

export function signalFingerprint(signals: DeviceSignals): string {
  const mfgKeys = Object.keys(signals.manufacturerData ?? {})
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .join(",");
  const parts = [
    signals.address,
    mfgKeys,
    signals.broadcastName ?? "",
    (signals.uuids ?? []).join(","),
    String(signals.txPower ?? ""),
  ];
  const digest = createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 12);
  return `SIG-${digest.toUpperCase()}`;
}

export function movementTrend(trail: TrailPoint[]): MovementTrend {
  if (trail.length < 4) return "unknown";
  const recent = trail
    .slice(-6)
    .map((p) => p.rssi)
    .filter((rssi): rssi is number => rssi != null);
  if (recent.length < 3) return "unknown";
  const delta = recent[recent.length - 1]! - recent[0]!;
  if (delta >= 5) return "approaching";
  if (delta <= -5) return "receding";
  return "static";
}

export function estimateTriangulation(
  deviceMac: string,
  hopGraph: HopGraph,
): TriangulationResult | null {
  const nmac = normalizeMac(deviceMac);
  const nodes: Record<string, Record<string, unknown>> = {};
  for (const n of hopGraph.nodes ?? []) {
    const id = String(n.id ?? "");
    if (id) nodes[id] = n;
  }

  const observations: TriangulationObservation[] = [];

  for (const edge of hopGraph.edges ?? []) {
    if (edge.hop !== 1) continue;
    const toId = String(edge.to ?? "");
    const target = nodes[toId];
    if (!target) continue;
    const kind = target.kind;
    if (kind !== "device" && kind !== "bridge") continue;
    const addr = String(target.address ?? "");
    if (!addr || normalizeMac(addr) !== nmac) continue;
    const rssi = edge.rssi;
    if (rssi == null || typeof rssi !== "number") continue;
    const fromNode = nodes[String(edge.from ?? "")] ?? {};
    observations.push({
      scanner: fromNode.label ?? edge.from,
      scannerId: edge.from,
      rssi,
      hopDepth: Number(fromNode.hopDepth ?? 0),
    });
  }

  if (observations.length < 2) return null;

  const strongest = observations.reduce((a, b) => (a.rssi >= b.rssi ? a : b));
  const weakest = observations.reduce((a, b) => (a.rssi <= b.rssi ? a : b));
  const spread = strongest.rssi - weakest.rssi;
  const avgRssi =
    observations.reduce((sum, o) => sum + o.rssi, 0) / observations.length;
  const estM = Math.max(1.0, Math.min(50.0, 10 ** ((-59 - avgRssi) / 20.0)));

  let confidence: TriangulationResult["confidence"] = "low";
  if (spread > 8) confidence = "high";
  else if (spread > 4) confidence = "medium";

  return {
    method: "multi-scanner-rssi",
    scannerCount: observations.length,
    estimatedMeters: Math.round(estM * 10) / 10,
    confidence,
    note: "Relative battlefield coords from cooperative scanners — not street GPS.",
    observations,
  };
}

function relayScores(hopGraph: HopGraph): RelayScore[] {
  const scores: Record<string, RelayScore> = {};

  for (const scanner of hopGraph.scanners ?? []) {
    const sid = String(scanner.nodeId ?? "");
    scores[sid] = {
      nodeId: sid,
      label: String(scanner.label ?? sid),
      contacts: Number(scanner.observationCount ?? 0),
      bridges: 0,
      score: 0,
      uptime: scanner.lastSeen ? "active" : "unknown",
    };
  }

  for (const node of hopGraph.nodes ?? []) {
    if (node.kind === "bridge" && node.linkedScanner) {
      const sid = String(node.linkedScanner);
      if (scores[sid]) {
        scores[sid].bridges += 1;
      }
    }
  }

  for (const edge of hopGraph.edges ?? []) {
    const via = edge.viaScanner ? String(edge.viaScanner) : "";
    if (via && scores[via] && edge.hop === 1) {
      scores[via].contacts = Math.max(scores[via].contacts, scores[via].contacts);
    }
  }

  const result = Object.values(scores);
  for (const s of result) {
    s.score = s.contacts * 10 + s.bridges * 25;
  }
  return result.sort((a, b) => b.score - a.score);
}

export function dominoBreachChains(hopGraph: HopGraph): DominoBreachChain[] {
  const chains = hopGraph.chains ?? [];
  if (chains.length === 0) return [];

  const metersPerHop = 15.0;
  const enriched: DominoBreachChain[] = chains.map((chain) => {
    const depth = Number(chain.hopDepth ?? 0);
    return {
      ...chain,
      estimatedReachMeters: Math.round(depth * metersPerHop),
      breachLabel: `CHAIN LENGTH ${depth} · EST. REACH ${Math.round(depth * metersPerHop)}m`,
    };
  });
  return enriched.sort(
    (a, b) => Number(b.hopDepth ?? 0) - Number(a.hopDepth ?? 0),
  );
}

class ChronoEvent {
  constructor(
    public ts: number,
    public eventType: string,
    public message: string,
    public details: Record<string, unknown> = {},
  ) {}

  toDict(): ChronoEventDict {
    return {
      ts: this.ts,
      tsMs: Math.floor(this.ts * 1000),
      type: this.eventType,
      message: this.message,
      details: this.details,
    };
  }
}

interface FingerprintHistoryEntry {
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
  macs: string[];
}

export class TacticalEngine {
  private scenarioId: ScenarioId = "standard";
  private watchlist = new Set<string>();
  private chrono: ChronoEvent[] = [];
  private trails: Record<string, TrailPoint[]> = {};
  private fingerprints: Record<string, string> = {};
  private fingerprintHistory: Record<string, FingerprintHistoryEntry> = {};
  private seenMacs = new Set<string>();
  private alerts: Record<string, unknown>[] = [];
  private packetSamples: Array<[number, number]> = [];
  private lastDeviceCount = 0;
  private missionId = "";
  private sseSubscribers: SseSubscriber[] = [];

  getScenarioId(): ScenarioId {
    return this.scenarioId;
  }

  currentScenario(): ScenarioConfig & { id: ScenarioId } {
    return { ...SCENARIOS[this.scenarioId], id: this.scenarioId };
  }

  setScenario(scenarioId: string): ScenarioConfig & { id: ScenarioId } {
    if (!(scenarioId in SCENARIOS)) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
    return withLock(() => {
      this.scenarioId = scenarioId as ScenarioId;
      this._log("scenario", `Mission preset: ${SCENARIOS[this.scenarioId].label}`, {
        scenario: scenarioId,
      });
      return this.currentScenario();
    });
  }

  addWatchlist(address: string): void {
    const key = normalizeMac(address);
    withLock(() => {
      this.watchlist.add(key);
      this._log("watchlist", `Target locked: ${formatMac(address)}`, {
        mac: formatMac(address),
      });
    });
  }

  removeWatchlist(address: string): void {
    const key = normalizeMac(address);
    withLock(() => {
      this.watchlist.delete(key);
    });
  }

  isOnWatchlist(address: string): boolean {
    return this.watchlist.has(normalizeMac(address));
  }

  getWatchlist(): string[] {
    return [...this.watchlist].map((m) => formatMac(m));
  }

  resetMission(): void {
    withLock(() => {
      this.missionId = `MSN-${Math.floor(Date.now() / 1000)}`;
      this.seenMacs.clear();
      this.trails = {};
      this.packetSamples = [];
      this.lastDeviceCount = 0;
      this._log("mission", "MISSION START — tactical sweep initiated", {
        missionId: this.missionId,
      });
    });
    SCI_FI.reset();
  }

  private _log(
    eventType: string,
    message: string,
    details: Record<string, unknown> = {},
  ): void {
    const event = new ChronoEvent(Date.now() / 1000, eventType, message, details);
    appendMax(this.chrono, event, CHRONO_MAX_EVENTS);
    const payload = jsonStringify(event.toDict());
    const dead: SseSubscriber[] = [];
    for (const sub of this.sseSubscribers) {
      if (sub.length > 200) {
        dead.push(sub);
        continue;
      }
      appendMax(sub, payload, 200);
    }
    for (const sub of dead) {
      const idx = this.sseSubscribers.indexOf(sub);
      if (idx >= 0) this.sseSubscribers.splice(idx, 1);
    }
  }

  log(
    eventType: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    withLock(() => {
      this._log(eventType, message, details ?? {});
    });
  }

  subscribeSse(): SseSubscriber {
    const sub: SseSubscriber = [];
    withLock(() => {
      this.sseSubscribers.push(sub);
    });
    return sub;
  }

  unsubscribeSse(sub: SseSubscriber): void {
    withLock(() => {
      const idx = this.sseSubscribers.indexOf(sub);
      if (idx >= 0) this.sseSubscribers.splice(idx, 1);
    });
  }

  onDeviceUpdate(
    signals: DeviceSignals,
    record: DeviceRecord,
    hopDepth?: number | null,
    hopGraph?: HopGraph,
    pairedNames?: Record<string, string>,
  ): OnDeviceUpdateResult {
    const mac = formatMac(signals.address);
    const nmac = normalizeMac(mac);
    const fp = signalFingerprint(signals);
    const now = Date.now() / 1000;

    let onWatchlist = false;

    withLock(() => {
      this.fingerprints[nmac] = fp;
      let hist = this.fingerprintHistory[fp];
      if (!hist) {
        hist = { fingerprint: fp, firstSeen: now, lastSeen: now, macs: [] };
        this.fingerprintHistory[fp] = hist;
      }
      hist.lastSeen = now;
      if (!hist.macs.includes(nmac)) {
        hist.macs.push(nmac);
      }

      if (!this.trails[nmac]) {
        this.trails[nmac] = [];
      }
      appendMax(
        this.trails[nmac]!,
        {
          ts: now,
          rssi: signals.rssi,
          distanceMeters: record.distanceMeters,
        },
        TRAIL_MAX_POINTS,
      );

      const isNew = !this.seenMacs.has(nmac);
      if (isNew) {
        this.seenMacs.add(nmac);
        this._log(
          "acquire",
          `SIGNAL ACQUIRED · ${record.displayName ?? mac}`,
          { mac, rssi: signals.rssi, fingerprint: fp },
        );
      }

      onWatchlist =
        this.watchlist.has(nmac) || this.watchlist.has(fp);
      const scenario = SCENARIOS[this.scenarioId];
      const rssiThreshold = scenario.proximityAlertRssi ?? -65;
      const watchlistOnly = scenario.watchlistOnlyAlerts ?? false;

      if (signals.rssi != null && signals.rssi >= rssiThreshold) {
        const shouldAlert = onWatchlist || !watchlistOnly;
        if (shouldAlert && (isNew || onWatchlist)) {
          const alert = {
            ts: now,
            type: "proximity",
            message: `PERIMETER BREACH · ${record.displayName ?? mac} @ ${signals.rssi} dBm`,
            mac,
            rssi: signals.rssi,
            priority: onWatchlist,
          };
          appendMax(this.alerts, alert, 100);
          this._log("alert", alert.message, alert);
        }
      }
    });

    const tier = threatTier(
      String(record.nameSource ?? "address"),
      String(record.proximityZone ?? "unknown"),
      onWatchlist,
      hopDepth,
    );
    const trail = this.trails[nmac] ?? [];
    const trend = movementTrend(trail);

    const sci = SCI_FI.analyzeDevice(
      signals,
      {
        ...record,
        fingerprint: fp,
        ghostTrail: [...trail],
        hopDepth,
      },
      hopGraph ?? {},
      pairedNames ?? {},
      { ...this.fingerprints },
      (type, message, details) => this.log(type, message, details),
    );

    const histEntry = this.fingerprintHistory[fp];
    const firstSeen = histEntry?.firstSeen ?? now;

    return {
      threatTier: tier,
      fingerprint: fp,
      movementTrend: trend,
      onWatchlist,
      ghostTrail: [...trail],
      knownEmitter: firstSeen < now - 60,
      sciFi: sci,
    };
  }

  onNameResolved(
    mac: string,
    oldName: string,
    newName: string,
    source: string,
  ): void {
    if (oldName !== newName) {
      this.log("decrypt", `NAME RESOLVED · ${newName} (${source})`, {
        mac,
        name: newName,
        source,
      });
    }
  }

  onPhaseChange(phase: string): void {
    this.log("phase", `PHASE → ${missionLabel(phase)}`, {
      phase,
      missionLabel: missionLabel(phase),
    });
  }

  onScanTick(
    deviceCount: number,
    devices?: DeviceRecord[],
    hopGraph?: HopGraph,
  ): void {
    const now = Date.now() / 1000;
    withLock(() => {
      appendMax(this.packetSamples, [now, deviceCount], INTERFERENCE_WINDOW);
      this.lastDeviceCount = deviceCount;
    });

    if (devices != null) {
      SCI_FI.tickPresence(devices);
      const active = new Set(
        devices.map((d) => normalizeMac(String(d.macAddress ?? d.id ?? ""))),
      );
      const byMac: Record<string, DeviceRecord> = {};
      for (const d of devices) {
        byMac[normalizeMac(String(d.macAddress ?? d.id ?? ""))] = d;
      }
      SCI_FI.tickLostDevices(active, byMac, (type, message, details) =>
        this.log(type, message, details),
      );
      if (hopGraph) {
        SCI_FI.updateCustody(devices, hopGraph);
        SCI_FI.recordWorm(
          Number(hopGraph.maxHopDepth ?? 0),
          Number(hopGraph.nodeCount ?? 0),
        );
      }
    }
  }

  interferenceLevel(): InterferenceResult {
    const samples = withLock(() => [...this.packetSamples]);
    if (samples.length < 5) {
      return { level: "clear", label: "SPECTRUM CLEAR", score: 0 };
    }

    const counts = samples.map((s) => s[1]);
    const volatility = Math.max(...counts) - Math.min(...counts);
    const recentDrop = counts[counts.length - 1]! < counts[0]! - 3;

    let level: InterferenceLevel = "clear";
    let label = "SPECTRUM CLEAR";

    if (recentDrop && volatility > 5) {
      level = "critical";
      label = "SPECTRUM NOISE CRITICAL";
    } else if (volatility > 3) {
      level = "elevated";
      label = "SPECTRUM NOISE ELEVATED";
    }

    return {
      level,
      label,
      score: volatility,
      samples: samples.length,
    };
  }

  buildDossier(record: DeviceRecord, hopGraph: HopGraph): Record<string, unknown> {
    const mac = String(record.macAddress ?? record.id ?? "");
    const nmac = normalizeMac(mac);
    const fp = this.fingerprints[nmac] ?? "";
    const trail = this.trails[nmac] ?? [];
    const tri = mac ? estimateTriangulation(mac, hopGraph) : null;

    const nodes: Record<string, Record<string, unknown>> = {};
    for (const n of hopGraph.nodes ?? []) {
      const id = String(n.id ?? "");
      if (id) nodes[id] = n;
    }

    const devId = `dev:${nmac}`;
    let pathLabels: string[] = [];
    if (nodes[devId]) {
      const pathIds = (nodes[devId].pathFromRoot as string[] | undefined) ?? [];
      pathLabels = pathIds.map((p) => String(nodes[p]?.label ?? p));
    }

    return {
      mac,
      displayName: record.displayName,
      threatTier: record.threatTier,
      fingerprint: fp,
      movementTrend: record.movementTrend,
      ghostTrail: trail.slice(-20),
      hopPath: pathLabels,
      hopDepth: record.hopDepth,
      triangulation: tri,
      passiveIntel: record.passiveIntel,
      exfilTier: record.exfilTier,
      intelSummary: record.intelSummary,
      charLabels: record.charLabels,
      gattAtlas: record.gattAtlas,
      pullStatus: record.pullStatus,
      pulledIntel: record.pulledData,
      theories: record.theories ?? [],
      screenRelay: recommendRelayPath(record),
      firstSeenInMission: this.fingerprintHistory[fp]?.firstSeen,
      dossierNote:
        "Tactical intel card — MAC is hardware ID, not street address.",
    };
  }

  snapshot(
    phase: string,
    hopGraph: HopGraph,
    devices?: DeviceRecord[],
  ): TacticalSnapshot {
    const { chrono, alerts, watchlist, fpCount, fpByMac } = withLock(() => ({
      chrono: this.chrono.slice(-100).map((e) => e.toDict()),
      alerts: this.alerts.slice(-20),
      watchlist: [...this.watchlist].map((m) =>
        m.length === 12 ? formatMac(m) : m,
      ),
      fpCount: Object.keys(this.fingerprintHistory).length,
      fpByMac: { ...this.fingerprints },
    }));

    const sciSnap = SCI_FI.snapshot(
      devices ?? [],
      hopGraph,
      this.fingerprintHistory as unknown as Record<string, Record<string, unknown>>,
      fpByMac,
    );

    return {
      brand: "houseofasher",
      missionId: this.missionId,
      missionPhase: phase,
      missionLabel: missionLabel(phase),
      scenario: this.currentScenario(),
      interference: this.interferenceLevel(),
      chrono,
      alerts,
      watchlist,
      fingerprintCount: fpCount,
      relayScores: relayScores(hopGraph),
      dominoBreaches: dominoBreachChains(hopGraph),
      ticker: chrono.length > 0 ? chrono[chrono.length - 1]!.message : "AWAITING ORDERS",
      sciFi: sciSnap,
    };
  }

  recordReplay(fullSnapshot: Record<string, unknown>): void {
    SCI_FI.recordReplayFrame(fullSnapshot);
  }

  buildExtractionPackage(
    scanSnapshot: Record<string, unknown>,
    hopGraph: HopGraph,
  ): Record<string, unknown> {
    const devices = (scanSnapshot.devices as DeviceRecord[] | undefined) ?? [];
    const dossiers = devices.map((d) => this.buildDossier(d, hopGraph));
    const phase = String(scanSnapshot.phase ?? "completed");
    const chrono = this.chrono.map((e) => e.toDict());

    return {
      brand: "houseofasher",
      packageType: "tactical-exfil",
      exportedAt: Date.now() / 1000,
      missionId: this.missionId,
      scenario: this.currentScenario(),
      missionLabel: missionLabel(phase),
      scannerLocation: scanSnapshot.scannerLocation,
      deviceCount: scanSnapshot.count ?? 0,
      devices,
      dossiers,
      hopGraph,
      dominoBreaches: dominoBreachChains(hopGraph),
      relayScores: relayScores(hopGraph),
      chrono,
      interference: this.interferenceLevel(),
      sciFi: SCI_FI.snapshot(
        devices,
        hopGraph,
        this.fingerprintHistory as unknown as Record<string, Record<string, unknown>>,
        { ...this.fingerprints },
      ),
      missionBrief: generateMissionBrief({
        count: scanSnapshot.count ?? 0,
        tactical: {
          missionId: this.missionId,
          missionLabel: missionLabel(phase),
          dominoBreaches: dominoBreachChains(hopGraph),
          chrono,
        },
        hopGraph,
      }),
    };
  }

  buildExtractionZip(packageData: Record<string, unknown>): Buffer {
    const missionId = String(packageData.missionId ?? "");
    const deviceCount = String(packageData.deviceCount ?? 0);
    const missionBrief = String(packageData.missionBrief ?? "");

    return createZip([
      {
        name: "mission_intel.json",
        data: jsonStringify(packageData, 2),
      },
      {
        name: "chrono_blackbox.json",
        data: jsonStringify(packageData.chrono ?? [], 2),
      },
      {
        name: "hop_graph.json",
        data: jsonStringify(packageData.hopGraph ?? {}, 2),
      },
      { name: "mission_brief.txt", data: missionBrief },
      {
        name: "README.txt",
        data:
          "# houseofasher tactical exfil package\n" +
          `Mission: ${missionId}\n` +
          `Devices: ${deviceCount}\n`,
      },
    ]);
  }

  buildCipherExfil(
    packageData: Record<string, unknown>,
    password: string,
  ): Buffer {
    return buildCipherZip(packageData, password);
  }
}

export const TACTICAL = new TacticalEngine();
