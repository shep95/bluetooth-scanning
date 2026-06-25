/** Passive advertisement intelligence — beacons, flags, manufacturer hints. */

import {
  COMPANY_NAMES,
  DeviceSignals,
  serviceUuidKey,
} from "./device-naming.js";

function hex(b: Buffer | null | undefined, limit: number = 48): string | null {
  if (!b || b.length === 0) {
    return null;
  }
  const h = b.toString("hex");
  return h.length > limit ? `${h.slice(0, limit)}…` : h;
}

export function parseIbeacon(mfg: Buffer): Record<string, unknown> | null {
  if (mfg.length < 23 || mfg[0] !== 0x4c || mfg[1] !== 0x00) {
    return null;
  }
  if (mfg[2] !== 0x02 || mfg[3] !== 0x15) {
    return null;
  }
  const uuid = mfg.subarray(4, 20).toString("hex");
  const major = mfg.readUInt16BE(20);
  const minor = mfg.readUInt16BE(22);
  const tx = mfg.readInt8(24);
  return {
    type: "iBeacon",
    uuid,
    major,
    minor,
    txPower: tx,
    label: `iBeacon ${major}.${minor}`,
  };
}

export function parseEddystone(
  serviceBytes: Buffer,
): Record<string, unknown> | null {
  if (!serviceBytes || serviceBytes.length === 0) {
    return null;
  }
  const frame = serviceBytes[0];
  if (frame === 0x00 && serviceBytes.length >= 18) {
    return { type: "eddystone_uid", label: "Eddystone-UID", raw: hex(serviceBytes) };
  }
  if (frame === 0x10) {
    return { type: "eddystone_url", label: "Eddystone-URL", raw: hex(serviceBytes) };
  }
  if (frame === 0x20) {
    return { type: "eddystone_tlm", label: "Eddystone-TLM", raw: hex(serviceBytes) };
  }
  if (frame === 0x40) {
    return { type: "eddystone_eid", label: "Eddystone-EID", raw: hex(serviceBytes) };
  }
  return null;
}

export function parseAppleMfg(mfg: Buffer): string[] {
  const hints: string[] = [];
  if (mfg.length < 2 || mfg[0] !== 0x4c || mfg[1] !== 0x00) {
    return hints;
  }
  if (mfg.length >= 4 && mfg[2] === 0x0f) {
    hints.push("Apple Nearby / Handoff hint");
  }
  if (mfg.length >= 4 && mfg[2] === 0x10) {
    hints.push("Apple AirDrop / AWDL hint");
  }
  if (mfg.length >= 4 && (mfg[2] === 0x05 || mfg[2] === 0x09)) {
    hints.push("Apple Find My / continuity");
  }
  return hints;
}

export function parseMicrosoftMfg(mfg: Buffer): string[] {
  if (mfg.length < 2 || mfg[0] !== 0x06 || mfg[1] !== 0x00) {
    return [];
  }
  return ["Microsoft Swift Pair / BLE pairable"];
}

export function parseGoogleFastPair(mfg: Buffer): string[] {
  if (
    mfg.length >= 3 &&
    ((mfg[0] === 0xe0 && mfg[1] === 0x00) || (mfg[0] === 0x8e && mfg[1] === 0x01))
  ) {
    return ["Google Fast Pair"];
  }
  return [];
}

export function buildPassiveIntel(signals: DeviceSignals): Record<string, unknown> {
  const mfgHints: string[] = [];
  const mfgRecords: Record<string, unknown>[] = [];
  const beacons: Record<string, unknown>[] = [];

  for (const [companyIdStr, raw] of Object.entries(signals.manufacturerData)) {
    const companyId = Number(companyIdStr);
    const name = COMPANY_NAMES[companyId] ?? `Company 0x${companyId.toString(16).padStart(4, "0").toUpperCase()}`;
    mfgRecords.push({
      companyId: `0x${companyId.toString(16).padStart(4, "0").toUpperCase()}`,
      companyName: name,
      hex: hex(raw),
    });
    const ibeacon = parseIbeacon(raw);
    if (ibeacon) {
      beacons.push(ibeacon);
    }
    mfgHints.push(...parseAppleMfg(raw));
    mfgHints.push(...parseMicrosoftMfg(raw));
    mfgHints.push(...parseGoogleFastPair(raw));
  }

  for (const raw of Object.values(signals.serviceData ?? {})) {
    const edd = parseEddystone(raw);
    if (edd) {
      beacons.push(edd);
    }
  }

  const serviceLabels = signals.uuids.map((u) => serviceUuidKey(u));
  const connectable =
    signals.broadcastName || signals.uuids.length > 0 ? "likely_connectable" : "unknown";

  return {
    theoryId: "adv_archaeology",
    narrative: "Passive advertisement archaeology",
    flaw: "Payloads are vendor-opaque without connect",
    flawType: "technical",
    fix: "Parse known Apple/Microsoft/Eddystone/iBeacon layouts",
    code: "ble_adv_intel.build_passive_intel",
    manufacturerRecords: mfgRecords,
    ecosystemHints: [...new Set(mfgHints)].sort(),
    beacons,
    serviceDataKeys: [...(signals.serviceDataKeys ?? [])],
    serviceLabels,
    connectableGuess: connectable,
    txPower: signals.txPower,
    broadcastName: signals.broadcastName,
  };
}
