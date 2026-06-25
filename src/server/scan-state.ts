/** Scan state — device map, hop ingest, GATT pull hooks. */

import { buildDeviceRecord, rememberPairedAliases } from "../ble/enrichment.js";
import {
  DeviceSignals,
  formatMac,
  normalizeMac,
  resolveName,
} from "../ble/device-naming.js";
import { HOP_GRAPH } from "../ble/hop-graph.js";
import { hopRelaySummary, mergeHopRelayDevices } from "../ble/hop-merge.js";
import { SCANNER_LOCATION } from "../ble/location.js";
import { loadAllPairedNames } from "../ble/paired-windows.js";
import { TACTICAL, missionLabel } from "../engine/tactical.js";

export type Phase = "idle" | "running" | "resolving" | "pulling" | "completed" | "failed";

export const HOP_INGEST_INTERVAL = 5.0;
export const AUTO_PULL_INTERVAL = 45.0;
export const PERSISTENT_SCAN = true;
export const ZERO_RESULT_HINT =
  "No advertisers yet — sweep is still running. Check Bluetooth ON, Windows Location ON, " +
  "and BLE devices nearby. Hop chains update every few seconds as companions report in.";

export class ScanState {
  phase: Phase = "idle";
  signals = new Map<string, DeviceSignals>();
  devices = new Map<string, Record<string, unknown>>();
  pairedNames: Record<string, string> = {};
  pulledData = new Map<string, Record<string, unknown>>();
  error: string | null = null;
  syncRequested = false;
  scanShutdown = false;
  startedAt: number | null = null;
  lastHopIngestAt: number | null = null;
  hopIngestCount = 0;
  lastHopDepthLogged = 0;

  snapshot(): Record<string, unknown> {
    const hopGraph = HOP_GRAPH.snapshot();
    const depthMap = new Map<string, number | undefined>();
    for (const n of (hopGraph.nodes as Array<Record<string, unknown>>) ?? []) {
      if (n.address) {
        depthMap.set(normalizeMac(String(n.address)), n.hopDepth as number | undefined);
      }
    }

    const deviceList: Record<string, unknown>[] = [];
    for (const d of this.devices.values()) {
      const mac = normalizeMac(String(d.macAddress ?? d.id ?? ""));
      d.hopDepth = depthMap.get(mac);
      deviceList.push(d);
    }
    deviceList.sort(
      (a, b) => ((b.rssi as number | null) ?? -999) - ((a.rssi as number | null) ?? -999),
    );
    const merged = mergeHopRelayDevices(deviceList, hopGraph);
    const hopRelay = hopRelaySummary(hopGraph, merged);
    TACTICAL.onScanTick(merged.length, merged, hopGraph);
    const tactical = TACTICAL.snapshot(this.phase, hopGraph, merged);
    const snap: Record<string, unknown> = {
      phase: this.phase,
      missionLabel: missionLabel(this.phase),
      running: this.phase === "running" || this.phase === "resolving" || this.phase === "pulling",
      persistent: PERSISTENT_SCAN,
      hopIngestInterval: HOP_INGEST_INTERVAL,
      lastHopIngestAt: this.lastHopIngestAt,
      hopIngestCount: this.hopIngestCount,
      error: this.error,
      devices: merged,
      count: merged.length,
      scannerLocation: SCANNER_LOCATION.snapshot(),
      pairedDevices: Object.entries(this.pairedNames)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([k, v]) => ({ mac: formatMac(k), name: v })),
      startedAt: this.startedAt,
      zeroResultHint:
        this.phase === "running" && merged.length === 0 ? ZERO_RESULT_HINT : null,
      hopGraph,
      hopRelay,
      tactical,
    };
    TACTICAL.recordReplay(snap);
    return snap;
  }

  async begin(): Promise<void> {
    if (this.phase === "running") return;
    this.phase = "running";
    this.signals.clear();
    this.devices.clear();
    this.pulledData.clear();
    this.pairedNames = await loadAllPairedNames();
    this.error = null;
    this.syncRequested = false;
    this.startedAt = Date.now() / 1000;
    this.lastHopIngestAt = null;
    this.hopIngestCount = 0;
    TACTICAL.resetMission();
    TACTICAL.onPhaseChange("running");
  }

  ingestHopLive(): number {
    const deviceList = [...this.devices.values()];
    this.lastHopIngestAt = Date.now() / 1000;
    if (!deviceList.length) return 0;
    const loc = SCANNER_LOCATION.snapshot();
    HOP_GRAPH.ingestPcScan(
      deviceList,
      loc.latitude as number | null,
      loc.longitude as number | null,
      loc.accuracyMeters as number | null,
    );
    this.hopIngestCount += 1;
    const maxDepth = (HOP_GRAPH.snapshot().maxHopDepth as number) ?? 0;
    if (maxDepth > this.lastHopDepthLogged) {
      this.lastHopDepthLogged = maxDepth;
      TACTICAL.log(
        "hop",
        `DOMINO CHAIN · depth ${maxDepth} · ${deviceList.length} contacts on root scanner`,
        { count: deviceList.length, maxHopDepth: maxDepth },
      );
    }
    return deviceList.length;
  }

  beginResolve(): void {
    this.phase = "resolving";
    TACTICAL.onPhaseChange("resolving");
  }

  beginPull(): void {
    this.phase = "pulling";
    TACTICAL.onPhaseChange("pulling");
  }

  finish(): void {
    const deviceList = this.phase !== "failed" ? [...this.devices.values()] : [];
    this.phase = this.error ? "failed" : "completed";
    TACTICAL.onPhaseChange(this.phase);
    if (deviceList.length) {
      const loc = SCANNER_LOCATION.snapshot();
      HOP_GRAPH.ingestPcScan(
        deviceList,
        loc.latitude as number | null,
        loc.longitude as number | null,
        loc.accuracyMeters as number | null,
      );
    }
  }

  fail(message: string): void {
    this.error = message;
    this.phase = "failed";
  }

  requestSync(): void {
    this.syncRequested = true;
  }

  mergeAdvertisement(
    address: string,
    device: { name?: string | null },
    adv: import("../ble/device-naming.js").BleAdvertisementData,
    source: string,
  ): void {
    const hopGraph = HOP_GRAPH.snapshot();
    const depthMap = new Map<string, number | undefined>();
    for (const n of (hopGraph.nodes as Array<Record<string, unknown>>) ?? []) {
      if (n.address) depthMap.set(normalizeMac(String(n.address)), n.hopDepth as number | undefined);
    }
    const key = formatMac(address);
    let existing = this.signals.get(key);
    const oldName = this.devices.get(key)?.displayName as string | undefined;
    if (!existing) {
      existing = new DeviceSignals(address);
      this.signals.set(key, existing);
    }
    existing.merge(device, adv, source);
    const pulled = this.pulledData.get(key) ?? null;
    const hopDepth = depthMap.get(normalizeMac(key));
    const record = buildDeviceRecord(
      existing,
      this.pairedNames,
      SCANNER_LOCATION,
      pulled,
      hopDepth,
      hopGraph,
    );
    record.lastSeen = Date.now();
    this.devices.set(key, record);
    if (oldName && oldName !== record.displayName) {
      TACTICAL.onNameResolved(key, oldName, String(record.displayName), String(record.nameSource ?? ""));
    }
  }

  applyResolvedRecords(): void {
    const hopGraph = HOP_GRAPH.snapshot();
    const depthMap = new Map<string, number | undefined>();
    for (const n of (hopGraph.nodes as Array<Record<string, unknown>>) ?? []) {
      if (n.address) depthMap.set(normalizeMac(String(n.address)), n.hopDepth as number | undefined);
    }
    for (const [key, signals] of this.signals) {
      const pulled = this.pulledData.get(key) ?? null;
      const hopDepth = depthMap.get(normalizeMac(key));
      const record = buildDeviceRecord(
        signals,
        this.pairedNames,
        SCANNER_LOCATION,
        pulled,
        hopDepth,
        hopGraph,
      );
      record.lastSeen = Date.now();
      this.devices.set(key, record);
    }
  }

  setPulledData(address: string, payload: Record<string, unknown>): void {
    const key = formatMac(address);
    const hopGraph = HOP_GRAPH.snapshot();
    const depthMap = new Map<string, number | undefined>();
    for (const n of (hopGraph.nodes as Array<Record<string, unknown>>) ?? []) {
      if (n.address) depthMap.set(normalizeMac(String(n.address)), n.hopDepth as number | undefined);
    }
    this.pulledData.set(key, payload);
    const signals = this.signals.get(key);
    if (signals) {
      const data = (payload.data as Record<string, unknown>) ?? {};
      if (data.osDeviceName) {
        signals.osName = String(data.osDeviceName);
        signals.gattName = signals.osName;
      }
      rememberPairedAliases(this.pairedNames, key, payload);
      const hopDepth = depthMap.get(normalizeMac(key));
      const record = buildDeviceRecord(
        signals,
        this.pairedNames,
        SCANNER_LOCATION,
        payload,
        hopDepth,
        hopGraph,
      );
      record.lastSeen = Date.now();
      this.devices.set(key, record);
      TACTICAL.log("exfil", `INTEL PULLED · ${record.displayName ?? key}`, { mac: key });
    }
  }

  hasDevice(address: string): boolean {
    const key = formatMac(address);
    return this.signals.has(key) || this.devices.has(key);
  }
}

export const STATE = new ScanState();
