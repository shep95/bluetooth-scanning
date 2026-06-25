/** Merge naming, distance, location context, and pulled GATT data into device records. */

import { buildPassiveIntel } from "./adv-intel.js";
import {
  DeviceSignals,
  formatMac,
  normalizeMac,
  resolveName,
  signalsToRecord,
} from "./device-naming.js";
import { distancePayload } from "./distance.js";
import { locationContextForDevice, type ScannerLocation } from "./location.js";
import { lookupPairedName, nameFromPairedValues } from "./paired-windows.js";
import { TACTICAL } from "../engine/tactical.js";
import { theoriesForDevice } from "./theory.js";

export function rssiHuman(rssi: number | null | undefined): string {
  if (rssi == null) {
    return "Signal strength unknown";
  }
  if (rssi >= -55) {
    return "Very strong signal — likely same room";
  }
  if (rssi >= -70) {
    return "Strong signal — nearby";
  }
  if (rssi >= -85) {
    return "Moderate signal — farther away";
  }
  return "Weak signal — far away or blocked by walls";
}

export function displayNameFromPull(
  pulledData: Record<string, unknown> | null | undefined,
  pairedNames: Record<string, string>,
): [string, string] | null {
  if (!pulledData) {
    return null;
  }

  const data = (pulledData.data as Record<string, unknown>) ?? {};

  const osName = data.osDeviceName;
  if (typeof osName === "string" && osName.trim()) {
    return [osName.trim(), "paired"];
  }

  const resolved = data.resolvedAddress;
  if (typeof resolved === "string") {
    const paired = lookupPairedName(resolved, pairedNames);
    if (paired) {
      return [paired, "paired"];
    }
  }

  const name = data.deviceName;
  if (typeof name === "string" && name.trim()) {
    const matched = nameFromPairedValues(name, pairedNames);
    return [matched ?? name.trim(), matched ? "paired" : "gatt"];
  }

  const mfg = data.manufacturerName;
  const model = data.modelNumber;
  if (mfg && model) {
    return [`${mfg} ${model}`, "gatt"];
  }
  if (mfg) {
    return [String(mfg), "gatt"];
  }
  if (model) {
    return [String(model), "gatt"];
  }

  if (pulledData.ok && osName) {
    return [String(osName), "paired"];
  }

  return null;
}

export function buildDeviceRecord(
  signals: DeviceSignals,
  pairedNames: Record<string, string>,
  scanner: ScannerLocation,
  pulledData?: Record<string, unknown> | null,
  hopDepth?: number | null,
  hopGraph?: Record<string, unknown> | null,
): Record<string, unknown> {
  const record = signalsToRecord(signals, pairedNames);
  const resolved = resolveName(signals, pairedNames);
  const pulledName = displayNameFromPull(pulledData, pairedNames);

  if (pulledName) {
    record.displayName = pulledName[0];
    record.nameSource = pulledName[1];
    record.name = pulledName[0];
  } else {
    record.displayName = resolved.display_name;
    record.name = resolved.display_name;
    record.nameSource = resolved.name_source;
  }

  const dist = distancePayload(signals.rssi, signals.txPower);
  Object.assign(record, dist);
  record.rssiHuman = rssiHuman(signals.rssi);
  record.rssiNote =
    "RSSI = signal strength in dBm. Closer to 0 is stronger (e.g. -45 is close, -85 is far).";
  record.macAddress = formatMac(signals.address);
  record.macNote = "Bluetooth MAC is a hardware ID — not a street address.";

  const pulledInner = (pulledData?.data as Record<string, unknown> | undefined)?.resolvedAddress;
  if (pulledInner) {
    record.identityAddress = pulledInner;
    record.identityNote =
      "Identity address resolved after connecting (may differ from random BLE MAC while scanning).";
  }

  record.location = locationContextForDevice(
    dist.distanceMeters as number | null | undefined,
    scanner,
  );
  record.passiveIntel = buildPassiveIntel(signals);
  record.pulledData = pulledData ?? null;

  if (pulledData) {
    record.exfilTier = pulledData.exfilTier ?? "UNKNOWN";
    record.gattAtlas = pulledData.gattAtlas ?? [];
    record.intelSummary = pulledData.intelSummary ?? [];
    record.charLabels = pulledData.charLabels ?? {};
  } else {
    record.exfilTier = "PASSIVE_ONLY";
    record.gattAtlas = [];
    record.intelSummary = [];
    record.charLabels = {};
  }

  if (pulledData == null) {
    record.pullStatus = "pending";
  } else if (pulledData.ok) {
    record.pullStatus = "ok";
  } else if ((pulledData.errors as unknown[] | undefined)?.length) {
    record.pullStatus = "failed";
  } else {
    record.pullStatus = "empty";
  }

  const tactical = TACTICAL.onDeviceUpdate(
    signals,
    record,
    hopDepth,
    hopGraph ?? undefined,
    pairedNames,
  );
  Object.assign(record, tactical);
  record.theories = theoriesForDevice(record);

  if (hopGraph) {
    const tri = TACTICAL.buildDossier(record, hopGraph).triangulation;
    if (tri) {
      record.triangulation = tri;
    }
  }

  return record;
}

export function rememberPairedAliases(
  pairedNames: Record<string, string>,
  scanAddress: string,
  pulledData?: Record<string, unknown> | null,
): void {
  if (!pulledData) {
    return;
  }
  const data = (pulledData.data as Record<string, unknown>) ?? {};
  let name = data.osDeviceName as string | undefined;
  if (!name) {
    const pulled = displayNameFromPull(pulledData, pairedNames);
    name = pulled?.[0];
  }
  if (!name) {
    return;
  }
  pairedNames[normalizeMac(scanAddress)] = name;
  const resolved = data.resolvedAddress;
  if (typeof resolved === "string") {
    pairedNames[normalizeMac(resolved)] = name;
  }
}
