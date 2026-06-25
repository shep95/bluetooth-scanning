/** Deep GATT exfil — standard characteristics + full service atlas. */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withBindings, type Characteristic, type Peripheral } from "@stoprocent/noble";
import { formatMac, serviceUuidKey } from "./device-naming.js";

export const GATT_TIMEOUT_SEC = 14.0;
export const CONNECT_PAUSE_SEC = 0.6;
export const NOTIFY_SAMPLE_SEC = 1.2;

export type ReadableCharKind =
  | "text"
  | "appearance"
  | "hex"
  | "battery"
  | "pnp"
  | "heart_rate"
  | "body_location";

export type ReadableChar = [string, string, string, ReadableCharKind];

export const READABLE_CHARS: ReadableChar[] = [
  ["00001800-0000-1000-8000-00805f9b34fb", "00002a00-0000-1000-8000-00805f9b34fb", "deviceName", "text"],
  ["00001800-0000-1000-8000-00805f9b34fb", "00002a01-0000-1000-8000-00805f9b34fb", "appearance", "appearance"],
  ["00001800-0000-1000-8000-00805f9b34fb", "00002a04-0000-1000-8000-00805f9b34fb", "connectionParams", "hex"],
  ["0000180f-0000-1000-8000-00805f9b34fb", "00002a19-0000-1000-8000-00805f9b34fb", "batteryLevel", "battery"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a29-0000-1000-8000-00805f9b34fb", "manufacturerName", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a24-0000-1000-8000-00805f9b34fb", "modelNumber", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a25-0000-1000-8000-00805f9b34fb", "serialNumber", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a26-0000-1000-8000-00805f9b34fb", "firmwareRevision", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a27-0000-1000-8000-00805f9b34fb", "hardwareRevision", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a28-0000-1000-8000-00805f9b34fb", "softwareRevision", "text"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a50-0000-1000-8000-00805f9b34fb", "pnpId", "pnp"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a23-0000-1000-8000-00805f9b34fb", "systemId", "hex"],
  ["0000180a-0000-1000-8000-00805f9b34fb", "00002a2a-0000-1000-8000-00805f9b34fb", "regulatoryCert", "hex"],
  ["00001805-0000-1000-8000-00805f9b34fb", "00002a2b-0000-1000-8000-00805f9b34fb", "currentTime", "hex"],
  ["0000180d-0000-1000-8000-00805f9b34fb", "00002a37-0000-1000-8000-00805f9b34fb", "heartRateBpm", "heart_rate"],
  ["0000180d-0000-1000-8000-00805f9b34fb", "00002a38-0000-1000-8000-00805f9b34fb", "bodySensorLocation", "body_location"],
  ["00001816-0000-1000-8000-00805f9b34fb", "00002a5b-0000-1000-8000-00805f9b34fb", "cscMeasurement", "hex"],
  ["00001814-0000-1000-8000-00805f9b34fb", "00002a53-0000-1000-8000-00805f9b34fb", "rscMeasurement", "hex"],
  ["0000181d-0000-1000-8000-00805f9b34fb", "00002a9e-0000-1000-8000-00805f9b34fb", "weightMeasurement", "hex"],
  ["0000181b-0000-1000-8000-00805f9b34fb", "00002a9c-0000-1000-8000-00805f9b34fb", "bodyComposition", "hex"],
  ["00001808-0000-1000-8000-00805f9b34fb", "00002a18-0000-1000-8000-00805f9b34fb", "glucoseMeasurement", "hex"],
  ["0000180f-0000-1000-8000-00805f9b34fb", "00002a1a-0000-1000-8000-00805f9b34fb", "batteryLevelState", "hex"],
];

export const APPEARANCE_MAP: Record<number, string> = {
  0x0040: "Phone",
  0x0080: "Computer",
  0x0140: "Watch",
  0x03c0: "Audio",
  0x03c1: "Headphones",
  0x0540: "HID",
  0x0940: "Blood Pressure",
  0x0980: "Cycling",
  0x0a40: "Pulse Oximeter",
};

export const BODY_LOCATION_MAP: Record<number, string> = {
  0: "Other",
  1: "Chest",
  2: "Wrist",
  3: "Finger",
  4: "Hand",
  5: "Ear lobe",
  6: "Foot",
};

export const CHAR_LABELS: Record<string, string> = {
  deviceName: "Device name",
  appearance: "Appearance class",
  connectionParams: "Connection params",
  batteryLevel: "Battery %",
  batteryLevelState: "Battery state",
  manufacturerName: "Manufacturer",
  modelNumber: "Model",
  serialNumber: "Serial",
  firmwareRevision: "Firmware",
  hardwareRevision: "Hardware",
  softwareRevision: "Software",
  pnpId: "PnP ID",
  systemId: "System ID",
  regulatoryCert: "Regulatory cert",
  currentTime: "Current time",
  heartRateBpm: "Heart rate (BPM)",
  bodySensorLocation: "Body sensor location",
  cscMeasurement: "Cycling speed/cadence",
  rscMeasurement: "Running speed/cadence",
  weightMeasurement: "Weight",
  bodyComposition: "Body composition",
  glucoseMeasurement: "Glucose",
  osDeviceName: "OS device name",
  resolvedAddress: "Identity MAC",
};

const noble = withBindings(process.platform === "win32" ? "win" : "default");

function charShort(uuid: string): string {
  const u = uuid.toLowerCase().replace(/-/g, "");
  if (u.length === 32) {
    return u.slice(4, 8);
  }
  return u;
}

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, "");
}

function uuidsMatch(a: string, b: string): boolean {
  const na = normalizeUuid(a);
  const nb = normalizeUuid(b);
  if (na === nb) {
    return true;
  }
  if (na.length === 32 && nb.length === 4) {
    return na.includes(nb);
  }
  if (nb.length === 32 && na.length === 4) {
    return nb.includes(na);
  }
  return na.endsWith(nb) || nb.endsWith(na);
}

export function decodeValue(
  key: string,
  kind: ReadableCharKind,
  raw: Buffer,
): unknown {
  if (kind === "battery" && raw.length >= 1) {
    return raw[0];
  }
  if (kind === "appearance" && raw.length >= 2) {
    const val = raw.readUInt16LE(0);
    return APPEARANCE_MAP[val] ?? `0x${val.toString(16).padStart(4, "0").toUpperCase()}`;
  }
  if (kind === "pnp" && raw.length >= 7) {
    const vidSource = raw[0];
    const vid = raw.readUInt16LE(1);
    const pid = raw.readUInt16LE(3);
    const ver = raw.readUInt16LE(5);
    return `vendor=0x${vid.toString(16).padStart(4, "0")} product=0x${pid.toString(16).padStart(4, "0")} ver=0x${ver.toString(16).padStart(4, "0")} src=${vidSource}`;
  }
  if (kind === "heart_rate" && raw.length >= 1) {
    const flags = raw[0]!;
    if ((flags & 0x01) !== 0 && raw.length >= 3) {
      return raw.readUInt16LE(1) & 0x1fff;
    }
    if (raw.length >= 2) {
      return raw[1];
    }
    return null;
  }
  if (kind === "body_location" && raw.length >= 1) {
    return BODY_LOCATION_MAP[raw[0]!] ?? `code ${raw[0]}`;
  }
  if (kind === "text") {
    const text = raw.toString("utf8").replace(/\0/g, "").trim();
    return text || null;
  }
  if (kind === "hex") {
    return raw.length > 0 ? raw.toString("hex") : null;
  }
  const text = raw.toString("utf8").replace(/\0/g, "").trim();
  return text || raw.toString("hex");
}


async function findCharacteristic(
  characteristics: Characteristic[],
  charUuid: string,
): Promise<Characteristic | null> {
  for (const characteristic of characteristics) {
    if (uuidsMatch(characteristic.uuid, charUuid)) {
      return characteristic;
    }
  }
  return null;
}

async function tryNotifySample(
  characteristic: Characteristic,
  key: string,
): Promise<unknown> {
  try {
    await characteristic.subscribeAsync();
    const raw = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("notify timeout"));
      }, NOTIFY_SAMPLE_SEC * 1000);
      const onData = (data: Buffer, isNotification: boolean) => {
        if (isNotification) {
          cleanup();
          resolve(data);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        characteristic.removeListener("data", onData);
      };
      characteristic.on("data", onData);
    });
    const kind: ReadableCharKind = key === "heartRateBpm" ? "heart_rate" : "hex";
    return decodeValue(key, kind, raw);
  } catch {
    return null;
  } finally {
    try {
      await characteristic.unsubscribeAsync();
    } catch {
      // ignore
    }
  }
}

async function buildGattAtlas(
  services: Awaited<
    ReturnType<Peripheral["discoverAllServicesAndCharacteristicsAsync"]>
  >["services"],
): Promise<Record<string, unknown>[]> {
  const atlas: Record<string, unknown>[] = [];
  for (const service of services) {
    const svcEntry: Record<string, unknown> = {
      uuid: String(service.uuid),
      key: serviceUuidKey(String(service.uuid)),
      characteristics: [] as Record<string, unknown>[],
    };
    for (const char of service.characteristics) {
      const props = [...char.properties];
      const entry: Record<string, unknown> = {
        uuid: String(char.uuid),
        key: charShort(String(char.uuid)),
        properties: props,
      };
      if (props.includes("read")) {
        try {
          const raw = await char.readAsync();
          entry.valueHex = raw.toString("hex");
          if (raw.length <= 32) {
            const text = raw.toString("utf8").replace(/\0/g, "").trim();
            entry.valueText = text || null;
          }
        } catch (exc) {
          entry.readError = String(exc).slice(0, 80);
        }
      }
      (svcEntry.characteristics as Record<string, unknown>[]).push(entry);
    }
    atlas.push(svcEntry);
  }
  return atlas;
}

function exfilTier(
  pulled: Record<string, unknown>,
  atlas: Record<string, unknown>[],
  errors: string[],
): string {
  if (pulled.heartRateBpm != null || pulled.batteryLevel != null) {
    return "PARTIAL";
  }
  if (atlas.length > 2 && Object.keys(pulled).length > 0) {
    return "PARTIAL";
  }
  if (errors.length > 0 && Object.keys(pulled).length === 0) {
    return "LOCKED";
  }
  if (Object.keys(pulled).length > 0) {
    return "OPEN";
  }
  return "UNKNOWN";
}

function intelSummary(
  pulled: Record<string, unknown>,
  atlas: Record<string, unknown>[],
): string[] {
  const lines: string[] = [];
  for (const key of [
    "osDeviceName",
    "deviceName",
    "appearance",
    "batteryLevel",
    "manufacturerName",
    "modelNumber",
    "heartRateBpm",
    "bodySensorLocation",
    "pnpId",
    "firmwareRevision",
  ]) {
    if (pulled[key] != null) {
      const label = CHAR_LABELS[key] ?? key;
      lines.push(`${label}: ${pulled[key]}`);
    }
  }
  lines.push(`GATT services mapped: ${atlas.length}`);
  return lines;
}

function result(
  address: string,
  pulled: Record<string, unknown>,
  errors: string[],
  atlas: Record<string, unknown>[],
): Record<string, unknown> {
  const tier = exfilTier(pulled, atlas, errors);
  return {
    ok: Boolean(Object.keys(pulled).length > 0 || atlas.length > 0),
    address,
    data: pulled,
    gattAtlas: atlas,
    exfilTier: tier,
    intelSummary: intelSummary(pulled, atlas),
    charLabels: CHAR_LABELS,
    errors: errors.slice(0, 12),
    pulledAt: Date.now(),
    narrative: "Deep GATT exfil + service atlas",
    flaw: "Many phones block unknown connections",
    fix: "Read standard chars + enumerate all services",
  };
}

async function findPeripheral(address: string): Promise<Peripheral> {
  await noble.waitForPoweredOnAsync();
  const target = address.toLowerCase();
  await noble.startScanningAsync([], false);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await noble.stopScanningAsync().catch(() => undefined);
      reject(new Error(`Device not found: ${address}`));
    }, GATT_TIMEOUT_SEC * 1000);

    const onDiscover = async (peripheral: Peripheral) => {
      const id = (peripheral.address ?? peripheral.id ?? "").toLowerCase();
      if (id !== target && peripheral.id?.toLowerCase() !== target) {
        return;
      }
      noble.removeListener("discover", onDiscover);
      clearTimeout(timer);
      await noble.stopScanningAsync().catch(() => undefined);
      resolve(peripheral);
    };

    noble.on("discover", onDiscover);
  });
}

export async function pullDeviceData(address: string): Promise<Record<string, unknown>> {
  const pulled: Record<string, unknown> = {};
  const errors: string[] = [];
  let atlas: Record<string, unknown>[] = [];
  let peripheral: Peripheral | null = null;

  try {
    peripheral = await findPeripheral(address);
    await peripheral.connectAsync();
    await sleep(CONNECT_PAUSE_SEC * 1000);

    const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
    const characteristics = services.flatMap((s) => s.characteristics);

    const advName = peripheral.advertisement?.localName;
    if (advName?.trim()) {
      pulled.osDeviceName = advName.trim();
    }

    const resolved = formatMac(peripheral.address ?? address);
    if (resolved) {
      pulled.resolvedAddress = resolved;
    }

    for (const [, charUuid, key, kind] of READABLE_CHARS) {
      if (key in pulled && kind !== "hex") {
        continue;
      }
      try {
        const characteristic = await findCharacteristic(characteristics, charUuid);
        if (!characteristic) {
          continue;
        }
        const raw = await characteristic.readAsync();
        const value = decodeValue(key, kind, raw);
        if (value != null) {
          pulled[key] = value;
        }
      } catch (exc) {
        errors.push(`${key}: ${exc}`);
      }
    }

    if (!("heartRateBpm" in pulled)) {
      const hrChar = await findCharacteristic(
        characteristics,
        "00002a37-0000-1000-8000-00805f9b34fb",
      );
      if (hrChar) {
        const hr = await tryNotifySample(hrChar, "heartRateBpm");
        if (hr != null) {
          pulled.heartRateBpm = hr;
        }
      }
    }

    atlas = await buildGattAtlas(services);
  } catch (exc) {
    return result(address, pulled, [String(exc)], atlas);
  } finally {
    if (peripheral) {
      try {
        await peripheral.disconnectAsync();
      } catch {
        // ignore
      }
    }
  }

  return result(address, pulled, errors, atlas);
}

export async function pullDevicesSequential(
  addresses: string[],
  onEach?: (address: string, result: Record<string, unknown>) => void,
): Promise<Record<string, Record<string, unknown>>> {
  const results: Record<string, Record<string, unknown>> = {};
  for (const address of addresses) {
    const pullResult = await pullDeviceData(address);
    results[address] = pullResult;
    onEach?.(address, pullResult);
    await sleep(350);
  }
  return results;
}

export function pullDeviceDataSync(address: string): Record<string, unknown> {
  const modulePath = fileURLToPath(new URL("./gatt-pull.js", import.meta.url));
  const code = `
    import { pullDeviceData } from ${JSON.stringify(modulePath)};
    const result = await pullDeviceData(${JSON.stringify(address)});
    process.stdout.write(JSON.stringify(result));
  `;
  const stdout = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      encoding: "utf8",
      timeout: (GATT_TIMEOUT_SEC + 10) * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
