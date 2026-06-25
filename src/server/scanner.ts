/** BLE scanner loop via @stoprocent/noble. */

import { withBindings, type Peripheral } from "@stoprocent/noble";
import type { BleAdvertisementData, BleDevice } from "../ble/device-naming.js";
import { pullDeviceDataSync } from "../ble/gatt-pull.js";
import { resolveName } from "../ble/device-naming.js";
import { TACTICAL } from "../engine/tactical.js";
import { AUTO_PULL_INTERVAL, HOP_INGEST_INTERVAL, STATE } from "./scan-state.js";

const noble = withBindings(process.platform === "win32" ? "win" : "default");

let scanRunning = false;
let scanLoopPromise: Promise<void> | null = null;

function parseManufacturerData(buf: Buffer | undefined): Record<number, Buffer> {
  if (!buf || buf.length < 2) return {};
  const companyId = buf.readUInt16LE(0);
  return { [companyId]: buf.subarray(2) };
}

function peripheralToAdv(peripheral: Peripheral): BleAdvertisementData {
  const a = peripheral.advertisement;
  const serviceData: Record<string, Buffer> = {};
  if (a.serviceData) {
    const raw = a.serviceData as unknown;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (entry && typeof entry === "object" && "uuid" in entry && "data" in entry) {
          const e = entry as { uuid: string; data: Buffer | Uint8Array };
          serviceData[e.uuid] = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
        }
      }
    } else if (typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, Buffer | Uint8Array>)) {
        serviceData[k] = Buffer.isBuffer(v) ? v : Buffer.from(v);
      }
    }
  }
  return {
    local_name: a.localName ?? null,
    rssi: peripheral.rssi ?? null,
    service_uuids: a.serviceUuids ?? [],
    manufacturer_data: parseManufacturerData(a.manufacturerData as Buffer | undefined),
    service_data: serviceData,
    tx_power: a.txPowerLevel ?? null,
  };
}

function onDiscover(peripheral: Peripheral): void {
  const address = peripheral.address || peripheral.id;
  if (!address) return;
  const device: BleDevice = { name: peripheral.advertisement.localName ?? null };
  STATE.mergeAdvertisement(address, device, peripheralToAdv(peripheral), "live");
}

function backgroundPullBatch(maxDevices = 2): void {
  const snap = STATE.snapshot();
  const ranked = [...((snap.devices as Record<string, unknown>[]) ?? [])].sort(
    (a, b) => ((b.rssi as number | null) ?? -999) - ((a.rssi as number | null) ?? -999),
  );
  let targets = ranked.filter((d) => d.pullStatus === "pending" || d.pullStatus === "failed").slice(0, maxDevices);
  if (!targets.length && ranked.length) targets = ranked.slice(0, 1);
  for (const d of targets) {
    const addr = String(d.id ?? d.macAddress ?? "");
    if (!addr) continue;
    try {
      const result = pullDeviceDataSync(addr);
      STATE.setPulledData(addr, result);
      TACTICAL.log(
        "exfil",
        `GATT ATLAS · ${d.displayName ?? addr} · tier ${result.exfilTier}`,
        { mac: addr, tier: result.exfilTier },
      );
    } catch (e) {
      TACTICAL.log("exfil", `Pull failed · ${addr}: ${e instanceof Error ? e.message : String(e)}`, {
        mac: addr,
      });
    }
  }
}

export async function checkBluetoothReady(): Promise<{
  ready: boolean;
  message: string;
  reason?: string;
}> {
  try {
    await noble.waitForPoweredOnAsync(8000);
    await noble.startScanningAsync([], true);
    await noble.stopScanningAsync();
    return { ready: true, message: "Bluetooth is on and ready to scan." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/powered off|radio/i.test(msg)) {
      return {
        ready: false,
        message: "Bluetooth is OFF. Turn it on in Settings > Bluetooth & devices.",
        reason: "POWERED_OFF",
      };
    }
    return { ready: false, message: msg, reason: "UNKNOWN" };
  }
}

async function runPersistentScan(): Promise<void> {
  await STATE.begin();
  let lastHop = 0;
  let lastAutoPull = 0;

  noble.on("discover", onDiscover);
  await noble.startScanningAsync([], true);
  TACTICAL.log("hop", "CONTINUOUS SWEEP — domino hop ingest active");

  while (!STATE.scanShutdown) {
    const now = Date.now() / 1000;
    if (now - lastHop >= HOP_INGEST_INTERVAL) {
      STATE.ingestHopLive();
      lastHop = now;
    }
    if (now - lastAutoPull >= AUTO_PULL_INTERVAL) {
      lastAutoPull = now;
      setImmediate(() => backgroundPullBatch(1));
    }
    if (STATE.syncRequested) {
      STATE.syncRequested = false;
      STATE.applyResolvedRecords();
      STATE.ingestHopLive();
      setImmediate(() => backgroundPullBatch(3));
      TACTICAL.log("hop", "Hop sync + GATT exfil queued — sweep continues");
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  try {
    await noble.stopScanningAsync();
  } catch {
    // ignore
  }
  noble.removeListener("discover", onDiscover);
  if (STATE.phase === "running") {
    STATE.fail("Scanner stopped unexpectedly");
  }
}

export function ensureScanLoop(): boolean {
  if (scanRunning) return false;
  const snap = STATE.snapshot();
  if (snap.phase === "running") return false;
  scanRunning = true;
  scanLoopPromise = runPersistentScan()
    .catch((e) => {
      STATE.fail(e instanceof Error ? e.message : String(e));
    })
    .finally(() => {
      scanRunning = false;
    });
  return true;
}

export async function scanOnce(durationSec: number): Promise<Record<string, unknown>[]> {
  const seen = new Map<string, Record<string, unknown>>();
  const handler = (peripheral: Peripheral) => {
    const address = peripheral.address || peripheral.id;
    if (!address) return;
    const adv = peripheralToAdv(peripheral);
    seen.set(address, {
      address,
      name: adv.local_name ?? peripheral.advertisement.localName ?? null,
      rssi: adv.rssi,
      seenAt: Date.now(),
    });
  };
  await noble.waitForPoweredOnAsync(8000);
  noble.on("discover", handler);
  await noble.startScanningAsync([], true);
  try {
    await new Promise((r) => setTimeout(r, durationSec * 1000));
  } finally {
    await noble.stopScanningAsync();
    noble.removeListener("discover", handler);
  }
  return [...seen.values()];
}

export { noble, resolveName };
