/** #houseofasher unified theory corpus — narrative → flaw → fix → code. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const theoryArrays = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../data/theory-arrays.json"),
    "utf8",
  ),
) as {
  TACTICAL_THEORIES: TheoryRecord[];
  PASSIVE_THEORIES: TheoryRecord[];
  GATT_THEORIES: TheoryRecord[];
  SECURITY_THEORIES: TheoryRecord[];
  ARCHITECTURE_THEORIES: TheoryRecord[];
  SCREEN_RELAY_THEORIES: TheoryRecord[];
  WIFI_POSE_THEORIES: TheoryRecord[];
};

export type FlawType =
  | "technical"
  | "security"
  | "privacy"
  | "legal"
  | "operational"
  | "ethical";

export type Category =
  | "tactical"
  | "passive"
  | "gatt"
  | "security"
  | "privacy"
  | "architecture"
  | "operational"
  | "screen_relay"
  | "wifi_pose";

export type TheoryRecord = Record<string, string>;

export const TACTICAL_THEORIES = theoryArrays.TACTICAL_THEORIES as TheoryRecord[];
export const PASSIVE_THEORIES = theoryArrays.PASSIVE_THEORIES as TheoryRecord[];
export const GATT_THEORIES = theoryArrays.GATT_THEORIES as TheoryRecord[];
export const SECURITY_THEORIES = theoryArrays.SECURITY_THEORIES as TheoryRecord[];
export const ARCHITECTURE_THEORIES = theoryArrays.ARCHITECTURE_THEORIES as TheoryRecord[];
export const SCREEN_RELAY_THEORIES = theoryArrays.SCREEN_RELAY_THEORIES as TheoryRecord[];
export const WIFI_POSE_THEORIES = theoryArrays.WIFI_POSE_THEORIES as TheoryRecord[];

export const ALL_THEORIES: TheoryRecord[] = [
  ...TACTICAL_THEORIES,
  ...PASSIVE_THEORIES,
  ...GATT_THEORIES,
  ...SECURITY_THEORIES,
  ...ARCHITECTURE_THEORIES,
  ...SCREEN_RELAY_THEORIES,
  ...WIFI_POSE_THEORIES,
];

export const THEORY_BY_ID: Record<string, TheoryRecord> = Object.fromEntries(
  ALL_THEORIES.map((t) => [t.id, t]),
);

export const THEORY_CATALOG = TACTICAL_THEORIES;
export const PULL_THEORY_CATALOG = GATT_THEORIES;
export const PASSIVE_THEORY_CATALOG = PASSIVE_THEORIES;

export function theoriesByCategory(category: string): TheoryRecord[] {
  return ALL_THEORIES.filter((t) => t.category === category);
}

export function theoriesByFlawType(flawType: string): TheoryRecord[] {
  return ALL_THEORIES.filter((t) => t.flawType === flawType);
}

export function theoriesForModule(module: string): TheoryRecord[] {
  return ALL_THEORIES.filter((t) => (t.module ?? "").startsWith(module));
}

export function theoryChain(theory: TheoryRecord): string {
  return (
    `${theory.narrative} → FLAW (${theory.flawType ?? "?"}): ${theory.flaw} ` +
    `→ FIX: ${theory.fix} → CODE: ${theory.code}`
  );
}

export function theorySnapshot(): Record<string, unknown> {
  const flawTypes = [...new Set(ALL_THEORIES.map((t) => t.flawType ?? "technical"))].sort();
  const categories = [...new Set(ALL_THEORIES.map((t) => t.category ?? "tactical"))].sort();
  return {
    brand: "houseofasher",
    pattern: "narrative → flaw → fix → code",
    total: ALL_THEORIES.length,
    categories,
    flawTypes,
    tactical: TACTICAL_THEORIES,
    passive: PASSIVE_THEORIES,
    gatt: GATT_THEORIES,
    security: SECURITY_THEORIES,
    architecture: ARCHITECTURE_THEORIES,
    screenRelay: SCREEN_RELAY_THEORIES,
    wifiPose: WIFI_POSE_THEORIES,
    all: ALL_THEORIES,
    screenRelayNote:
      "BLE finds devices; Wi‑Fi/USB/HDMI/AirPlay/scrcpy show screens — always with user consent.",
    note: "Sci-fi labels map to honest BLE limits. Security flaws include privacy, legal, and ethical classes.",
  };
}

function hasBeacon(passive: Record<string, unknown> | null | undefined): boolean {
  return Boolean(passive?.beacons);
}

function pulledData(record: Record<string, unknown>): Record<string, unknown> {
  return ((record.pulledData as Record<string, unknown> | undefined)?.data as Record<string, unknown>) ?? {};
}

export function theoriesForDevice(record: Record<string, unknown>): TheoryRecord[] {
  const ids: string[] = ["adv_tracking", "rssi_tracking", "mac_rotation"];
  const passive = (record.passiveIntel as Record<string, unknown>) ?? {};
  const data = pulledData(record);
  const tier = String(record.exfilTier ?? "PASSIVE_ONLY");

  if (hasBeacon(passive)) {
    for (const b of (passive.beacons as Record<string, unknown>[]) ?? []) {
      const bt = String(b.type ?? "");
      if (bt.toLowerCase().includes("ibeacon")) {
        ids.push("ibeacon");
      }
      if (bt.toLowerCase().includes("eddystone")) {
        ids.push("eddystone");
      }
    }
  }
  for (const hint of (passive.ecosystemHints as string[]) ?? []) {
    const h = hint.toLowerCase();
    if (h.includes("apple")) {
      ids.push("apple_continuity");
    }
    if (h.includes("microsoft") || h.includes("swift")) {
      ids.push("swift_pair");
    }
    if (h.includes("google") || h.includes("fast pair")) {
      ids.push("fast_pair");
    }
  }

  if (record.nameSource === "paired") {
    ids.push("paired_registry");
  }
  if (record.nameSource === "broadcast") {
    ids.push("naming_broadcast");
  }

  if (tier === "LOCKED") {
    ids.push(
      "gatt_unauth_read",
      "mitm_gatt",
      "gatt_screen_blocked",
      "locked_phone_path",
      "ble_to_wifi_handoff",
    );
  } else if (tier === "OPEN" || tier === "PARTIAL") {
    ids.push("atlas", "dossier_gatt");
  }
  if (tier === "PASSIVE_ONLY") {
    ids.push("adv_archaeology");
  }

  if (data.serialNumber) {
    ids.push("serial_exposure");
  }
  if (data.heartRateBpm != null) {
    ids.push("biometric", "health_data");
  }
  if (data.glucoseMeasurement) {
    ids.push("medical");
  }
  if (data.resolvedAddress) {
    ids.push("identity");
  }
  if (data.batteryLevel != null) {
    ids.push("battery");
  }

  if (record.onWatchlist) {
    ids.push("watchlist", "spoof");
  }
  if (record.threatTier === "breach") {
    ids.push("domino_breach");
  }
  if (record.fingerprint) {
    ids.push("fingerprint");
  }

  const sci = (record.sciFi as Record<string, unknown>) ?? {};
  if (sci.spoof) {
    ids.push("spoof_name_attack");
  }
  if ((sci.quorum as Record<string, unknown> | undefined)?.quorumMet) {
    ids.push("quorum");
  }
  if ((sci.geofence as Record<string, unknown> | undefined)?.breach) {
    ids.push("geofence");
  }
  if (record.movementTrend === "approaching" || record.movementTrend === "receding") {
    ids.push("posesense_vision", "ble_rssi_proxy", "identity_pose_fusion");
  }

  const seen = new Set<string>();
  const out: TheoryRecord[] = [];
  for (const tid of ids) {
    if (seen.has(tid)) {
      continue;
    }
    const t = THEORY_BY_ID[tid];
    if (t) {
      seen.add(tid);
      out.push({ ...t, chain: theoryChain(t) });
    }
  }
  return out;
}

export function securitySummary(
  devices: Record<string, unknown>[],
): Record<string, unknown> {
  const locked = devices.filter((d) => d.exfilTier === "LOCKED").length;
  const serials = devices.filter((d) => pulledData(d).serialNumber).length;
  const health = devices.filter((d) => pulledData(d).heartRateBpm != null).length;
  const beacons = devices.reduce(
    (sum, d) =>
      sum + (((d.passiveIntel as Record<string, unknown>)?.beacons as unknown[])?.length ?? 0),
    0,
  );
  const high = SECURITY_THEORIES.filter((t) => t.severity === "high");
  return {
    devicesTracked: devices.length,
    gattLocked: locked,
    serialsExposed: serials,
    healthReads: health,
    beaconsDecoded: beacons,
    highSeverityTheories: high.length,
    operatorNote: "Use only on networks and devices you are authorized to assess.",
  };
}

export function appendTheoryBrief(
  lines: string[],
  devices: Record<string, unknown>[],
): void {
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
    `- Categories: ${(theorySnapshot().categories as string[]).join(", ")}`,
    `- Flaw types: ${(theorySnapshot().flawTypes as string[]).join(", ")}`,
  );
}
