/** Resolve BLE device display names from multiple sources. */

import { execSync } from "node:child_process";
import { platform } from "node:os";

export type NameSource = "broadcast" | "paired" | "gatt" | "inferred" | "address";

export const DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb";
export const GATT_MAX_ENRICH = 5;
export const GATT_TIMEOUT_SEC = 4.0;

export const COMPANY_NAMES: Readonly<Record<number, string>> = {
  0x004c: "Apple",
  0x0006: "Microsoft",
  0x000f: "Broadcom",
  0x0075: "Samsung",
  0x00e0: "Google",
  0x0087: "Garmin",
  0x0157: "Anker",
  0x0318: "Sonos",
  0x0499: "Nintendo",
  0x05ac: "Apple",
  0x0a5c: "Bose",
  0x0d8c: "Jabra",
  0x1915: "Nordic Semiconductor",
  0x2204: "Tile",
  0x2412: "Sony",
  0x3432: "Fitbit",
  0x4154: "Tile",
};

export const SERVICE_LABELS: Readonly<Record<string, string>> = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "180A": "Device Information",
  "180D": "Heart Rate",
  "180F": "Battery",
  "1812": "HID",
  "181C": "User Data",
  "FE2C": "Google Fast Pair",
  "FE95": "Xiaomi",
  "FE9F": "Google",
  "FDAA": "Sonos",
};

export interface BleDevice {
  name?: string | null;
}

export interface BleAdvertisementData {
  local_name?: string | null;
  rssi?: number | null;
  service_uuids?: Iterable<string>;
  manufacturer_data?: Readonly<Record<number, Buffer | Uint8Array>>;
  service_data?: Readonly<Record<string, Buffer | Uint8Array>>;
  tx_power?: number | null;
}

export function normalizeMac(address: string): string {
  return address.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function formatMac(address: string): string {
  const mac = normalizeMac(address);
  if (mac.length !== 12) {
    return address;
  }
  return Array.from({ length: 6 }, (_, i) => mac.slice(i * 2, i * 2 + 2)).join(":");
}

export function shortMacSuffix(address: string): string {
  const mac = formatMac(address);
  const parts = mac.split(":");
  return parts.length >= 3 ? parts.slice(-3).join(":") : mac;
}

export function serviceUuidKey(uuid: string): string {
  const u = uuid.toLowerCase().replace(/-/g, "");
  if (u.length === 4) {
    return u.toUpperCase();
  }
  if (u.length === 32 && u.endsWith("00001000800000805f9b34fb")) {
    return u.slice(4, 8).toUpperCase();
  }
  return u.length >= 4 ? u.slice(-4).toUpperCase() : u.toUpperCase();
}

export function decodeRegistryString(value: Buffer | string): string | null {
  const text = (typeof value === "string" ? value : value.toString("utf8"))
    .replace(/\0/g, "")
    .trim();
  return text || null;
}

function readRegStringValue(keyPath: string, valueName: string): string | null {
  try {
    const out = execSync(`reg query "${keyPath}" /v ${valueName}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out
      .split(/\r?\n/)
      .find((l: string) => l.includes(valueName) && l.includes("REG_"));
    if (!line) {
      return null;
    }
    const idx = line.indexOf("REG_");
    if (idx < 0) {
      return null;
    }
    const raw = line.slice(idx).replace(/^REG_\w+\s+/, "").trim();
    return decodeRegistryString(raw);
  } catch {
    return null;
  }
}

export function loadWindowsPairedNames(): Record<string, string> {
  const names: Record<string, string> = {};
  if (platform() !== "win32") {
    return names;
  }

  const base = "HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices";
  let listing = "";
  try {
    listing = execSync(`reg query "${base}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return names;
  }

  const keyNames = new Set<string>();
  for (const line of listing.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/Devices\\([0-9A-Fa-f]{12})$/);
    if (match) {
      keyNames.add(match[1]!);
    }
  }

  for (const keyName of keyNames) {
    const keyPath = `${base}\\${keyName}`;
    for (const valueName of ["LEName", "Name"] as const) {
      const decoded = readRegStringValue(keyPath, valueName);
      if (decoded) {
        names[normalizeMac(keyName)] = decoded;
        break;
      }
    }
  }

  return names;
}

export class DeviceSignals {
  address: string;
  broadcastName: string | null = null;
  rssi: number | null = null;
  uuids: string[] = [];
  manufacturerData: Record<number, Buffer> = {};
  serviceDataKeys: string[] = [];
  serviceData: Record<string, Buffer> = {};
  txPower: number | null = null;
  gattName: string | null = null;
  osName: string | null = null;
  scanSource = "live";

  constructor(address: string) {
    this.address = address;
  }

  merge(device: BleDevice, adv: BleAdvertisementData, source: string): void {
    this.scanSource = source;
    const candidate = (adv.local_name ?? device.name ?? "").trim();
    if (candidate && !looksLikeMac(candidate)) {
      this.broadcastName = candidate;
    }
    if (device.name?.trim() && !looksLikeMac(device.name)) {
      this.osName = device.name.trim();
    }
    if (adv.rssi != null) {
      this.rssi = adv.rssi;
    }
    const advUuids = adv.service_uuids ? [...adv.service_uuids].map(String) : [];
    this.uuids = [...new Set([...this.uuids, ...advUuids])].sort();
    if (adv.manufacturer_data) {
      for (const [key, value] of Object.entries(adv.manufacturer_data)) {
        this.manufacturerData[Number(key)] = Buffer.from(value);
      }
    }
    const serviceKeys = adv.service_data ? Object.keys(adv.service_data).map(String) : [];
    this.serviceDataKeys = [...new Set([...this.serviceDataKeys, ...serviceKeys])].sort();
    if (adv.service_data) {
      for (const [key, value] of Object.entries(adv.service_data)) {
        this.serviceData[String(key)] = Buffer.from(value);
      }
    }
    if (adv.tx_power != null) {
      this.txPower = adv.tx_power;
    }
  }
}

function looksLikeMac(value: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value);
}

export interface ResolvedName {
  display_name: string;
  name_source: NameSource;
  broadcast_name: string | null;
  manufacturer: string | null;
  inferred_detail: string | null;
}

export function manufacturerLabel(manufacturerData: Readonly<Record<number, Buffer>>): string | null {
  for (const companyId of Object.keys(manufacturerData)
    .map(Number)
    .sort((a, b) => a - b)) {
    const label = COMPANY_NAMES[companyId];
    if (label) {
      return label;
    }
  }
  return null;
}

export function serviceLabels(uuids: string[], limit = 2): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const uuid of uuids) {
    const key = serviceUuidKey(uuid);
    const label = SERVICE_LABELS[key];
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
    if (labels.length >= limit) {
      break;
    }
  }
  return labels;
}

export function inferLabel(signals: DeviceSignals): string | null {
  const parts: string[] = [];
  const mfg = manufacturerLabel(signals.manufacturerData);
  if (mfg) {
    parts.push(mfg);
  }
  const svc = serviceLabels(signals.uuids);
  if (svc.length) {
    parts.push(svc.join(" + "));
  }
  if (signals.serviceDataKeys.length && !svc.length) {
    parts.push("Service data");
  }
  if (!parts.length && signals.uuids.length) {
    parts.push(`${signals.uuids.length} service(s)`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function resolveName(signals: DeviceSignals, pairedNames: Record<string, string>): ResolvedName {
  const broadcast = signals.broadcastName;
  if (broadcast) {
    return {
      display_name: broadcast,
      name_source: "broadcast",
      broadcast_name: broadcast,
      manufacturer: manufacturerLabel(signals.manufacturerData),
      inferred_detail: null,
    };
  }

  const mac = normalizeMac(signals.address);
  const paired = pairedNames[mac];
  if (paired) {
    return {
      display_name: paired,
      name_source: "paired",
      broadcast_name: null,
      manufacturer: manufacturerLabel(signals.manufacturerData),
      inferred_detail: null,
    };
  }

  if (signals.osName) {
    return {
      display_name: signals.osName,
      name_source: "paired",
      broadcast_name: null,
      manufacturer: manufacturerLabel(signals.manufacturerData),
      inferred_detail: null,
    };
  }

  if (signals.gattName) {
    return {
      display_name: signals.gattName,
      name_source: "gatt",
      broadcast_name: null,
      manufacturer: manufacturerLabel(signals.manufacturerData),
      inferred_detail: null,
    };
  }

  const inferred = inferLabel(signals);
  if (inferred) {
    return {
      display_name: inferred,
      name_source: "inferred",
      broadcast_name: null,
      manufacturer: manufacturerLabel(signals.manufacturerData),
      inferred_detail: inferred,
    };
  }

  const suffix = shortMacSuffix(signals.address);
  return {
    display_name: `BLE device · ${suffix}`,
    name_source: "address",
    broadcast_name: null,
    manufacturer: manufacturerLabel(signals.manufacturerData),
    inferred_detail: null,
  };
}

export type DeviceRecord = Record<string, unknown>;

export function signalsToRecord(signals: DeviceSignals, pairedNames: Record<string, string>): DeviceRecord {
  const resolved = resolveName(signals, pairedNames);
  return {
    id: formatMac(signals.address),
    displayName: resolved.display_name,
    name: resolved.display_name,
    nameSource: resolved.name_source,
    broadcastName: resolved.broadcast_name,
    manufacturer: resolved.manufacturer,
    inferredDetail: resolved.inferred_detail,
    rssi: signals.rssi,
    uuids: signals.uuids,
    source: signals.scanSource,
    lastSeen: 0,
  };
}

/** Optional hook for platform BLE GATT reads (wired by scan server integration). */
export type GattNameReader = (address: string) => Promise<string | null>;

let gattNameReader: GattNameReader | null = null;

export function setGattNameReader(reader: GattNameReader | null): void {
  gattNameReader = reader;
}

export async function readGattDeviceName(address: string): Promise<string | null> {
  if (!gattNameReader) {
    return null;
  }
  try {
    const text = await gattNameReader(address);
    if (!text) {
      return null;
    }
    return text.replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

export async function enrichWithGattNames(
  signalsMap: Record<string, DeviceSignals>,
  pairedNames: Record<string, string>,
): Promise<void> {
  const candidates: DeviceSignals[] = [];
  for (const signals of Object.values(signalsMap)) {
    const resolved = resolveName(signals, pairedNames);
    if (resolved.name_source === "inferred" || resolved.name_source === "address") {
      candidates.push(signals);
    }
  }

  candidates.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  const targets = candidates.slice(0, GATT_MAX_ENRICH);
  if (!targets.length) {
    return;
  }

  const results = await Promise.all(targets.map((s) => readGattDeviceName(s.address)));
  for (let i = 0; i < targets.length; i++) {
    const result = results[i];
    if (typeof result === "string" && result) {
      targets[i]!.gattName = result;
    }
  }
}
