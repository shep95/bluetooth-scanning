/** #houseofasher sci-fi theories — narrative → flaw → fix → code. */

import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

import theoryArrays from "../data/theory-arrays.json" with { type: "json" };
import {
  DeviceSignals,
  formatMac,
  normalizeMac,
  serviceUuidKey,
} from "../ble/device-naming.js";

export const REPLAY_MAX = 120;
export const RESURRECT_GAP_SEC = 45.0;
export const QUORUM_MIN_SCANNERS = 2;
export const COOCCURRENCE_TICK_SEC = 30.0;

type JsonRecord = Record<string, unknown>;

export interface HopGraphInput {
  nodes?: ReadonlyArray<{
    id?: string;
    label?: string;
    address?: string;
    kind?: string;
    pathFromRoot?: string[];
  }>;
  edges?: ReadonlyArray<{ hop?: number; from?: string; to?: string }>;
  scanners?: ReadonlyArray<{ label?: string; nodeId?: string; observationCount?: number }>;
  maxHopDepth?: number;
  nodeCount?: number;
}

interface TheoryRecord {
  id: string;
  category?: string;
  narrative?: string;
  flaw?: string;
  flawType?: string;
  fix?: string;
  code?: string;
  module?: string;
  severity?: string;
}

const THEORY_CATALOG = theoryArrays.TACTICAL_THEORIES as TheoryRecord[];
const ALL_THEORIES: TheoryRecord[] = [
  ...theoryArrays.TACTICAL_THEORIES,
  ...theoryArrays.PASSIVE_THEORIES,
  ...theoryArrays.GATT_THEORIES,
  ...theoryArrays.SECURITY_THEORIES,
  ...theoryArrays.ARCHITECTURE_THEORIES,
  ...theoryArrays.SCREEN_RELAY_THEORIES,
  ...theoryArrays.WIFI_POSE_THEORIES,
] as TheoryRecord[];

export const UUID_CLASS: Readonly<Record<string, string>> = {
  "180D": "WEARABLE",
  "180F": "BATTERY",
  "1812": "HID",
  "110E": "AUDIO",
  "110B": "AUDIO",
  "FE2C": "FAST_PAIR",
  "FE95": "IOT",
  "FEAA": "BEACON",
  "FDAA": "SPEAKER",
};

function pulledData(record: JsonRecord): JsonRecord {
  return ((record.pulledData as JsonRecord | undefined)?.data as JsonRecord | undefined) ?? {};
}

function securitySummary(devices: JsonRecord[]): JsonRecord {
  const locked = devices.filter((d) => d.exfilTier === "LOCKED").length;
  const serials = devices.filter((d) => pulledData(d).serialNumber != null).length;
  const health = devices.filter((d) => pulledData(d).heartRateBpm != null).length;
  const beacons = devices.reduce((sum, d) => {
    const passive = (d.passiveIntel as JsonRecord | undefined) ?? {};
    const list = (passive.beacons as unknown[] | undefined) ?? [];
    return sum + list.length;
  }, 0);
  const high = theoryArrays.SECURITY_THEORIES.filter((t) => t.severity === "high").length;
  return {
    devicesTracked: devices.length,
    gattLocked: locked,
    serialsExposed: serials,
    healthReads: health,
    beaconsDecoded: beacons,
    highSeverityTheories: high,
    operatorNote: "Use only on networks and devices you are authorized to assess.",
  };
}

function theorySnapshotCategories(): string[] {
  return [...new Set(ALL_THEORIES.map((t) => t.category ?? "tactical"))].sort();
}

function theorySnapshotFlawTypes(): string[] {
  return [...new Set(ALL_THEORIES.map((t) => t.flawType ?? "technical"))].sort();
}

function appendTheoryBrief(lines: string[], devices: JsonRecord[]): void {
  const sec = securitySummary(devices);
  lines.push(
    "",
    "## Security & ethics posture",
    `- Devices in sweep: ${sec.devicesTracked}`,
    `- GATT locked (blocked connect): ${sec.gattLocked}`,
    `- Serial numbers read: ${sec.serialsExposed}`,
    `- Health characteristic reads: ${sec.healthReads}`,
    `- Beacons decoded (passive): ${sec.beaconsDecoded}`,
    `- High-severity theory controls documented: ${sec.highSeverityTheories}`,
    `- ${sec.operatorNote}`,
    "",
    "## Theory corpus",
    `- Total narrative→flaw→fix→code chains: ${ALL_THEORIES.length}`,
    `- Categories: ${theorySnapshotCategories().join(", ")}`,
    `- Flaw types: ${theorySnapshotFlawTypes().join(", ")}`,
  );
}

export function stableFingerprint(signals: DeviceSignals): string {
  const mfg = Object.keys(signals.manufacturerData)
    .map(Number)
    .sort((a, b) => a - b)
    .join(",");
  const body = [mfg, signals.broadcastName ?? "", (signals.uuids ?? []).join(",")].join("|");
  return createHash("sha256").update(body).digest("hex").slice(0, 16).toUpperCase();
}

export function classifyBeaconDialect(signals: DeviceSignals): JsonRecord {
  const labels: string[] = [];
  for (const u of signals.uuids ?? []) {
    const key = serviceUuidKey(u);
    if (key in UUID_CLASS) {
      labels.push(UUID_CLASS[key]!);
    }
  }
  if (Object.keys(signals.manufacturerData).length) {
    labels.push("MFG_ADV");
  }
  const dialectTags = labels.length ? [...new Set(labels)].sort() : ["UNKNOWN_DIALECT"];
  return {
    dialect: dialectTags[0],
    dialectTags,
    narrative: "Beacon dialect analysis",
    fix: "Rule-based UUID/manufacturer classification",
  };
}

export function passiveProtocolProfile(signals: DeviceSignals): JsonRecord {
  const mfgIds = Object.keys(signals.manufacturerData)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => `0x${k.toString(16)}`);
  return {
    profileId: `PRT-${stableFingerprint(signals).slice(0, 8)}`,
    serviceKeys: (signals.uuids ?? []).map((u) => serviceUuidKey(u)),
    manufacturerIds: mfgIds,
    txPower: signals.txPower,
    serviceDataKeys: [...(signals.serviceDataKeys ?? [])],
  };
}

export function deviceMindReading(record: JsonRecord): JsonRecord {
  const caps: string[] = [];
  const uuids = (record.uuids as string[] | undefined) ?? [];
  for (const u of uuids) {
    const key = serviceUuidKey(String(u));
    if (key === "180D") {
      caps.push("heart_rate");
    } else if (key === "1812") {
      caps.push("hid_input");
    } else if (key === "180F") {
      caps.push("battery_service");
    } else if (key === "110E" || key === "110B") {
      caps.push("audio");
    }
  }
  const pulled = pulledData(record);
  if (pulled.batteryLevel != null) {
    caps.push("battery_readable");
  }
  if (pulled.modelNumber) {
    caps.push("model_disclosed");
  }
  return {
    capabilities: caps.length ? [...new Set(caps)].sort() : ["unknown"],
    mindNote: "Inferred from GATT/services — not literal mind reading.",
  };
}

export function vectorPursuit(trail: JsonRecord[]): JsonRecord {
  if (trail.length < 3) {
    return { velocityDbPerSec: 0, bearing: "unknown", confidence: "low" };
  }
  const filtered = trail.slice(-8).filter((p) => p.rssi != null);
  const rs = filtered.map((p) => p.rssi as number);
  const ts = filtered.map((p) => p.ts as number);
  if (rs.length < 2 || ts[ts.length - 1] === ts[0]) {
    return { velocityDbPerSec: 0, bearing: "unknown", confidence: "low" };
  }
  const vel = (rs[rs.length - 1]! - rs[0]!) / Math.max(0.1, ts[ts.length - 1]! - ts[0]!);
  const bearing = vel > 0.5 ? "closing" : vel < -0.5 ? "opening" : "parallel";
  const conf = Math.abs(vel) > 2 ? "high" : Math.abs(vel) > 0.8 ? "medium" : "low";
  return { velocityDbPerSec: Math.round(vel * 100) / 100, bearing, confidence: conf };
}

export function containmentGeofence(record: JsonRecord, rssiThreshold = -62): JsonRecord {
  const rssi = record.rssi as number | null | undefined;
  const zone = record.proximityZone ?? "unknown";
  const inside = rssi != null && rssi >= rssiThreshold;
  return {
    insidePerimeter: inside,
    perimeterRssi: rssiThreshold,
    zone,
    breach: inside && ["unknown", "priority", "breach"].includes(String(record.threatTier)),
  };
}

export function echoRanging(trail: JsonRecord[], hopObs: JsonRecord[]): JsonRecord | null {
  if (trail.length < 4 || hopObs.length < 2) {
    return null;
  }
  const rs = trail
    .slice(-4)
    .filter((p) => p.rssi != null)
    .map((p) => p.rssi as number);
  if (rs.length < 2) {
    return null;
  }
  const delta = rs[rs.length - 1]! - rs[0]!;
  const hopDelta =
    hopObs.length > 0
      ? ((hopObs[hopObs.length - 1]?.rssi as number | undefined) ?? 0) -
        ((hopObs[0]?.rssi as number | undefined) ?? 0)
      : 0;
  const trend = delta > 3 ? "approaching_root" : delta < -3 ? "receding_root" : "stable";
  return { rootTrend: trend, rssiDelta: delta, multiNodeDelta: hopDelta };
}

export function meshQuorum(mac: string, hopGraph: HopGraphInput, minimum = QUORUM_MIN_SCANNERS): JsonRecord {
  const nmac = normalizeMac(mac);
  const scanners = new Set<string>();
  const nodes = Object.fromEntries((hopGraph.nodes ?? []).map((n) => [String(n.id), n]));
  for (const edge of hopGraph.edges ?? []) {
    if (edge.hop !== 1) {
      continue;
    }
    const tgt = nodes[String(edge.to ?? "")];
    if (!tgt) {
      continue;
    }
    const addr = String(tgt.address ?? "");
    if (addr && normalizeMac(addr) === nmac) {
      scanners.add(String(edge.from ?? ""));
    }
  }
  const count = scanners.size;
  return {
    scannerCount: count,
    quorumMet: count >= minimum,
    status: count >= minimum ? "CONFIRMED" : "PENDING",
    scanners: [...scanners],
  };
}

export function shadowTrack(fingerprint: string, hopGraph: HopGraphInput, mac: string): JsonRecord {
  const nmac = normalizeMac(mac);
  const nodes = Object.fromEntries((hopGraph.nodes ?? []).map((n) => [String(n.id), n]));
  const dev = nodes[`dev:${nmac}`];
  let path: string[] = [];
  if (dev?.pathFromRoot) {
    path = (dev.pathFromRoot as string[]).map((p) => String(nodes[p]?.label ?? p));
  }
  return { shadowPath: path, fingerprint, relayActive: path.length > 2 };
}

export function batteryOracle(record: JsonRecord, advTicks: number): JsonRecord {
  const batt = pulledData(record).batteryLevel;
  if (batt != null) {
    return { source: "gatt", level: batt, status: "known" };
  }
  const cadence = advTicks > 20 ? "active" : advTicks > 5 ? "idle" : "dormant";
  return { source: "inferred", cadence, status: "estimated" };
}

export function tomographyGrid(hopGraph: HopGraphInput): JsonRecord[] {
  const zones: JsonRecord[] = [];
  for (const scanner of hopGraph.scanners ?? []) {
    const obs = (scanner.observationCount as number | undefined) ?? 0;
    zones.push({
      node: scanner.label,
      nodeId: scanner.nodeId,
      heat: Math.min(100, obs * 8),
      note: "RSSI heat from cooperative scanner — not literal through-wall imaging.",
    });
  }
  return zones;
}

export function wormTimeline(history: JsonRecord[]): JsonRecord[] {
  return history.slice(-40);
}

export function detectTemporalAnomaly(
  mac: string,
  hopDepth: number | null | undefined,
  prev: Record<string, number>,
): JsonRecord | null {
  if (hopDepth == null) {
    return null;
  }
  const nmac = normalizeMac(mac);
  const old = prev[nmac];
  if (old != null && hopDepth > old + 2) {
    return {
      anomaly: true,
      message: `TEMPORAL ANOMALY · hop depth jumped ${old} → ${hopDepth}`,
      previousDepth: old,
      currentDepth: hopDepth,
    };
  }
  return null;
}

export function detectCloneClusters(fingerprintHistory: Record<string, JsonRecord>): JsonRecord[] {
  const clusters: JsonRecord[] = [];
  for (const [fp, hist] of Object.entries(fingerprintHistory)) {
    const macs = (hist.macs as string[] | undefined) ?? [];
    if (macs.length >= 2) {
      clusters.push({
        fingerprint: fp,
        macCount: macs.length,
        macs: macs.slice(0, 6).map((m) => (m.length === 12 ? formatMac(m) : m)),
        label: "PROBABLE SAME EMITTER (cloned MACs)",
      });
    }
  }
  return clusters;
}

export function detectSpoof(
  record: JsonRecord,
  watchlistNames: Record<string, string>,
  fingerprintByMac: Record<string, string>,
  trustedPrints: Set<string>,
): JsonRecord | null {
  const name = String(record.displayName ?? "").toLowerCase();
  if (!name) {
    return null;
  }
  for (const trusted of Object.values(watchlistNames)) {
    if (trusted.toLowerCase() === name) {
      const fp =
        String(record.fingerprint ?? "") ||
        fingerprintByMac[normalizeMac(String(record.id ?? ""))] ||
        "";
      if (fp && !trustedPrints.has(fp)) {
        return {
          spoof: true,
          message: `MIMIC ALERT · name '${record.displayName}' with unknown signature`,
          displayName: record.displayName,
          fingerprint: fp,
        };
      }
    }
  }
  return null;
}

export function buildCooccurrenceClusters(presenceLog: Record<string, Set<string>>): JsonRecord[] {
  const pairCounts = new Map<string, number>();
  for (const macs of Object.values(presenceLog)) {
    const ml = [...macs].sort();
    for (let i = 0; i < ml.length; i++) {
      for (let j = i + 1; j < ml.length; j++) {
        const key = `${ml[i]}|${ml[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const clusters: JsonRecord[] = [];
  const sorted = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [pair, n] of sorted) {
    if (n >= 2) {
      const [a, b] = pair.split("|");
      clusters.push({ devices: [a, b], coOccurrences: n, label: "ASSOCIATED CLUSTER" });
    }
  }
  return clusters;
}

export function generateMissionBrief(snapshot: JsonRecord): string {
  const tac = (snapshot.tactical as JsonRecord | undefined) ?? {};
  const sci = (tac.sciFi as JsonRecord | undefined) ?? {};
  const lines = [
    "# houseofasher MISSION BRIEF",
    `Mission ID: ${tac.missionId ?? "?"}`,
    `Phase: ${tac.missionLabel ?? "?"}`,
    `Contacts: ${snapshot.count ?? 0}`,
    `Hop depth: ${((snapshot.hopGraph as JsonRecord | undefined)?.maxHopDepth as number | undefined) ?? 0}`,
    `Quorum confirmed: ${sci.quorumConfirmed ?? 0}`,
    `Clone clusters: ${((sci.cloneClusters as unknown[] | undefined) ?? []).length}`,
    `Spoof alerts: ${((sci.spoofAlerts as unknown[] | undefined) ?? []).length}`,
    `Resurrections: ${((sci.resurrections as unknown[] | undefined) ?? []).length}`,
    `Co-occurrence clusters: ${((sci.cohortClusters as unknown[] | undefined) ?? []).length}`,
    "",
    "## Domino breach chains",
  ];
  for (const c of ((tac.dominoBreaches as JsonRecord[] | undefined) ?? []).slice(0, 5)) {
    const path = (c.path as string[] | undefined) ?? [];
    lines.push(`- ${c.breachLabel ?? c.target ?? "?"}: ${path.join(" → ")}`);
  }
  lines.push("", "## Recent chrono", "");
  for (const e of ((tac.chrono as JsonRecord[] | undefined) ?? []).slice(-8)) {
    lines.push(`- [${e.type}] ${e.message}`);
  }
  appendTheoryBrief(lines, (snapshot.devices as JsonRecord[] | undefined) ?? []);
  lines.push("");
  lines.push("_Generated from live BLE sweep — MACs are hardware IDs, not street addresses._");
  return lines.join("\n");
}

export function encryptPackage(payload: Buffer, password: string): Buffer {
  const key = createHash("sha256").update(password).digest();
  const scrambled = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    scrambled[i] = payload[i]! ^ key[i % key.length]!;
  }
  return Buffer.from(scrambled.toString("base64"), "utf8");
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: d };
}

function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data) >>> 0;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    parts.push(local, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);
    central.push(centralHeader);

    offset += local.length + compressed.length;
  }

  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, end]);
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === "bigint") {
        return String(v);
      }
      if (v instanceof Buffer) {
        return v.toString("hex");
      }
      if (v instanceof Set) {
        return [...v];
      }
      if (v instanceof Map) {
        return Object.fromEntries(v);
      }
      return v;
    },
    2,
  );
}

export function buildCipherZip(pkg: JsonRecord, password: string): Buffer {
  const raw = Buffer.from(jsonStringify(pkg), "utf8");
  const enc = encryptPackage(raw, password);
  return buildZip([
    { name: "mission_intel.enc", data: enc },
    {
      name: "README.txt",
      data: Buffer.from(
        "# houseofasher cipher exfil\nDecrypt mission_intel.enc with /api/decrypt using the same password.\n",
        "utf8",
      ),
    },
  ]);
}

export type SciFiLogFn = (type: string, message: string, detail?: JsonRecord) => void;

interface ReplayFrame {
  ts: number;
  count: number;
  maxHopDepth: number;
  devices: JsonRecord[];
}

export class SciFiEngine {
  lastSeen = new Map<string, number>();
  lostMarked = new Set<string>();
  resurrections: JsonRecord[] = [];
  spoofAlerts: JsonRecord[] = [];
  custody = new Map<string, JsonRecord[]>();
  advTickCount = new Map<string, number>();
  hopDepthPrev: Record<string, number> = {};
  anomalies: JsonRecord[] = [];
  presenceTicks = new Map<string, Set<string>>();
  lastCooccurrenceTick = 0;
  replayBuffer: ReplayFrame[] = [];
  wormHistory: JsonRecord[] = [];
  trustedFingerprints = new Set<string>();
  listeningPosts = new Set<string>();
  teamMode = "red_blue";

  reset(): void {
    this.lastSeen.clear();
    this.lostMarked.clear();
    this.resurrections = [];
    this.spoofAlerts = [];
    this.custody.clear();
    this.advTickCount.clear();
    this.hopDepthPrev = {};
    this.anomalies = [];
    this.presenceTicks.clear();
    this.lastCooccurrenceTick = 0;
    this.replayBuffer = [];
    this.wormHistory = [];
  }

  registerListeningPost(nodeId: string): void {
    this.listeningPosts.add(nodeId);
  }

  tickPresence(devices: JsonRecord[]): void {
    const now = Date.now() / 1000;
    if (now - this.lastCooccurrenceTick < COOCCURRENCE_TICK_SEC) {
      return;
    }
    this.lastCooccurrenceTick = now;
    const tickId = String(Math.floor(now));
    const macs = new Set(
      devices
        .map((d) => normalizeMac(String(d.macAddress ?? d.id ?? "")))
        .filter((m) => m.length > 0),
    );
    this.presenceTicks.set(tickId, macs);
  }

  recordReplayFrame(snapshot: JsonRecord): void {
    this.replayBuffer.push({
      ts: Date.now() / 1000,
      count: (snapshot.count as number | undefined) ?? 0,
      maxHopDepth: ((snapshot.hopGraph as JsonRecord | undefined)?.maxHopDepth as number | undefined) ?? 0,
      devices: ((snapshot.devices as JsonRecord[] | undefined) ?? []).slice(0, 20).map((d) => ({
        id: d.id,
        rssi: d.rssi,
        name: d.displayName,
      })),
    });
    if (this.replayBuffer.length > REPLAY_MAX) {
      this.replayBuffer = this.replayBuffer.slice(-REPLAY_MAX);
    }
  }

  recordWorm(maxDepth: number, nodeCount: number): void {
    this.wormHistory.push({
      ts: Date.now() / 1000,
      maxHopDepth: maxDepth,
      nodeCount,
    });
    if (this.wormHistory.length > 200) {
      this.wormHistory = this.wormHistory.slice(-200);
    }
  }

  analyzeDevice(
    signals: DeviceSignals,
    record: JsonRecord,
    hopGraph: HopGraphInput,
    watchlistNames: Record<string, string>,
    fingerprintByMac: Record<string, string>,
    logFn: SciFiLogFn,
  ): JsonRecord {
    const mac = formatMac(signals.address);
    const nmac = normalizeMac(mac);
    const now = Date.now() / 1000;
    const fp = String(record.fingerprint ?? "") || stableFingerprint(signals);
    const trail = (record.ghostTrail as JsonRecord[] | undefined) ?? [];

    this.advTickCount.set(nmac, (this.advTickCount.get(nmac) ?? 0) + 1);

    if (this.lostMarked.has(nmac)) {
      const gap = now - (this.lastSeen.get(nmac) ?? now);
      this.lostMarked.delete(nmac);
      const evt: JsonRecord = { mac, gapSec: Math.round(gap * 10) / 10, name: record.displayName };
      this.resurrections.push(evt);
      logFn(
        "resurrect",
        `SIGNAL RESURRECTED · ${record.displayName ?? mac} after ${Math.floor(gap)}s`,
        evt,
      );
    }

    this.lastSeen.set(nmac, now);

    const hopDepth = record.hopDepth as number | null | undefined;
    const anomaly = detectTemporalAnomaly(mac, hopDepth, this.hopDepthPrev);
    if (hopDepth != null) {
      this.hopDepthPrev[nmac] = hopDepth;
    }
    if (anomaly) {
      this.anomalies.push({ ...anomaly, mac, ts: now });
      logFn("anomaly", String(anomaly.message), anomaly);
    }

    const spoof = detectSpoof(record, watchlistNames, fingerprintByMac, this.trustedFingerprints);
    if (spoof) {
      this.spoofAlerts.push({ ...spoof, ts: now, mac });
      logFn("spoof", String(spoof.message), spoof);
    }

    const tri = (record.triangulation as JsonRecord | undefined) ?? {};
    const hopObs = tri ? ((tri.observations as JsonRecord[] | undefined) ?? []) : [];

    return {
      dialect: classifyBeaconDialect(signals),
      protocol: passiveProtocolProfile(signals),
      mind: deviceMindReading(record),
      pursuit: vectorPursuit(trail),
      geofence: containmentGeofence(record),
      shadow: shadowTrack(fp, hopGraph, mac),
      echo: echoRanging(trail, hopObs),
      quorum: meshQuorum(mac, hopGraph),
      battery: batteryOracle(record, this.advTickCount.get(nmac) ?? 0),
    };
  }

  tickLostDevices(activeMacs: Set<string>, devicesByMac: Record<string, JsonRecord>, logFn: SciFiLogFn): void {
    const now = Date.now() / 1000;
    for (const [nmac, last] of [...this.lastSeen.entries()]) {
      if (activeMacs.has(nmac)) {
        continue;
      }
      if (now - last > RESURRECT_GAP_SEC && !this.lostMarked.has(nmac)) {
        this.lostMarked.add(nmac);
        const d = devicesByMac[nmac] ?? {};
        logFn(
          "lost",
          `SIGNAL LOST · ${d.displayName ?? formatMac(nmac)}`,
          { mac: formatMac(nmac), gapSec: RESURRECT_GAP_SEC },
        );
      }
    }
  }

  updateCustody(devices: JsonRecord[], hopGraph: HopGraphInput): void {
    const scanners = Object.fromEntries(
      (hopGraph.scanners ?? []).map((s) => [String(s.nodeId), s.label]),
    );
    for (const d of devices) {
      const nmac = normalizeMac(String(d.macAddress ?? d.id ?? ""));
      const fp = String(d.fingerprint ?? "");
      if (!nmac) {
        continue;
      }
      const q = meshQuorum(nmac, hopGraph);
      const scannerList = (q.scanners as string[] | undefined) ?? [];
      if (!scannerList.length) {
        continue;
      }
      const sid = scannerList[0]!;
      const entry: JsonRecord = {
        ts: Date.now() / 1000,
        scanner: scanners[sid] ?? sid,
        scannerId: sid,
        rssi: d.rssi,
      };
      const key = fp || nmac;
      const chain = this.custody.get(key) ?? [];
      if (!chain.length || chain[chain.length - 1]?.scannerId !== sid) {
        chain.push(entry);
      }
      if (chain.length > 30) {
        this.custody.set(key, chain.slice(-30));
      } else {
        this.custody.set(key, chain);
      }
    }
  }

  snapshot(
    devices: JsonRecord[],
    hopGraph: HopGraphInput,
    fingerprintHistory: Record<string, JsonRecord>,
    _fingerprintByMac: Record<string, string>,
  ): JsonRecord {
    const quorumConfirmed = devices.filter(
      (d) => meshQuorum(String(d.id ?? ""), hopGraph).quorumMet,
    ).length;
    const custodyChains: Record<string, JsonRecord[]> = {};
    let custodyCount = 0;
    for (const [k, v] of this.custody.entries()) {
      if (custodyCount >= 12) {
        break;
      }
      custodyChains[k] = v.slice(-5);
      custodyCount++;
    }
    return {
      theories: THEORY_CATALOG,
      teamMode: this.teamMode,
      cloneClusters: detectCloneClusters(fingerprintHistory),
      spoofAlerts: this.spoofAlerts.slice(-10),
      resurrections: this.resurrections.slice(-10),
      anomalies: this.anomalies.slice(-10),
      cohortClusters: buildCooccurrenceClusters(
        Object.fromEntries([...this.presenceTicks.entries()]),
      ),
      custodyChains,
      tomography: tomographyGrid(hopGraph),
      wormTimeline: wormTimeline(this.wormHistory),
      replayFrames: this.replayBuffer.slice(-30),
      quorumConfirmed,
      listeningPosts: [...this.listeningPosts],
      narrativeNote:
        "Sci-fi labels map to honest BLE limits — see /api/theories for narrative→flaw→fix→code.",
      theoryCount: ALL_THEORIES.length,
    };
  }
}

export const SCI_FI = new SciFiEngine();

// Re-export theory catalog for consumers that mirror Python imports.
export { THEORY_CATALOG, ALL_THEORIES };
