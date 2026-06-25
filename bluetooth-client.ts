// bluetooth-client.ts — #houseofasher tactical BLE client (all API calls)

export type HexString = `0x${string}`;
export type NameSource = "broadcast" | "paired" | "gatt" | "inferred" | "address";
export type ProximityZone = "immediate" | "near" | "far" | "unknown";
export type ScanPhase = "idle" | "running" | "resolving" | "pulling" | "completed" | "failed";
export type ThreatTier = "friendly" | "known" | "unknown" | "priority" | "breach";
export type MovementTrend = "approaching" | "receding" | "static" | "unknown";
export type ScenarioId = "standard" | "perimeter" | "asset_recovery" | "silent_observe" | "deep_pull";
export type ExfilTier = "OPEN" | "PARTIAL" | "LOCKED" | "PASSIVE_ONLY" | "UNKNOWN";
export type FlawType = "security" | "privacy" | "legal" | "ethical" | "technical" | "operational";

export interface HealthStatus {
  ready: boolean;
  message: string;
  reason?: string;
}

export interface ScannerLocation {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  address: string | null;
  addressShort: string | null;
  source: string | null;
  ready: boolean;
}

export interface DeviceLocationContext {
  coLocated: boolean;
  estimatedAddress: string | null;
  estimatedAddressShort: string | null;
  scannerLatitude: number | null;
  scannerLongitude: number | null;
  contextNote: string;
}

export interface PulledDeviceData {
  ok: boolean;
  address: string;
  data: Record<string, string | number>;
  errors: string[];
  pulledAt: number;
  exfilTier?: ExfilTier;
}

export interface PassiveIntel {
  broadcastName?: string | null;
  connectableGuess?: string | null;
  txPower?: number | null;
  beacons?: Array<{ type?: string; label?: string; uuid?: string; raw?: string }>;
  ecosystemHints?: string[];
  manufacturerRecords?: Array<{ companyName: string; hex?: string }>;
  serviceLabels?: string[];
}

export interface TheoryChain {
  id: string;
  narrative: string;
  flaw: string;
  fix: string;
  code?: string;
  flawType?: FlawType;
  chain?: string;
}

export interface ScannedDevice {
  id: string;
  displayName: string;
  name: string;
  nameSource: NameSource;
  broadcastName: string | null;
  manufacturer: string | null;
  inferredDetail: string | null;
  rssi: number | null;
  txPower: number | null;
  distanceMeters: number | null;
  distanceFeet: number | null;
  distanceMiles: number | null;
  distanceLabel: string;
  proximityZone: ProximityZone;
  distanceNote: string;
  location: DeviceLocationContext;
  pulledData: PulledDeviceData | null;
  pullStatus: "pending" | "ok" | "failed" | "empty" | "hop_relay";
  uuids: string[];
  source?: string;
  lastSeen: number;
  threatTier?: ThreatTier;
  fingerprint?: string;
  movementTrend?: MovementTrend;
  onWatchlist?: boolean;
  ghostTrail?: Array<{ ts: number; rssi: number | null; distanceMeters: number | null }>;
  hopDepth?: number | null;
  triangulation?: Record<string, unknown>;
  passiveIntel?: PassiveIntel;
  gattAtlas?: Array<Record<string, unknown>>;
  theories?: TheoryChain[];
  exfilTier?: ExfilTier;
  charLabels?: Record<string, string>;
  intelSummary?: string[];
  sciFi?: Record<string, unknown>;
  hopRelayOnly?: boolean;
  reportedByScanner?: string;
  alsoReportedBy?: string[];
  macAddress?: string;
  identityAddress?: string;
}

export interface TacticalSnapshot {
  brand: string;
  missionId: string;
  missionPhase: string;
  missionLabel: string;
  scenario: { id: ScenarioId; label: string; description: string };
  interference: { level: string; label: string; score: number };
  chrono: Array<{ ts: number; type: string; message: string }>;
  alerts: Array<{ ts: number; message: string; mac?: string }>;
  watchlist: string[];
  relayScores: Array<{ nodeId: string; label: string; score: number; contacts: number; bridges: number }>;
  dominoBreaches: Array<{ target: string; hopDepth: number; breachLabel: string; path: string[] }>;
  ticker: string;
  sciFi?: Record<string, unknown>;
}

export interface HopRelaySummary {
  directContacts: number;
  relayOnlyContacts: number;
}

export interface ScanSnapshot {
  phase: ScanPhase;
  missionLabel?: string;
  running: boolean;
  error: string | null;
  devices: ScannedDevice[];
  count: number;
  scannerLocation: ScannerLocation;
  zeroResultHint: string | null;
  hopGraph?: Record<string, unknown>;
  tactical?: TacticalSnapshot;
  persistent?: boolean;
  startedAt?: number;
  hopIngestCount?: number;
  hopRelay?: HopRelaySummary;
}

export interface ScenarioOption {
  id: ScenarioId;
  label: string;
  description?: string;
}

export interface ScenarioListResponse {
  active: ScenarioId;
  scenarios: ScenarioOption[];
}

export interface TheoriesSnapshot {
  pattern?: string;
  total?: number;
  wifiPose?: TheoryChain[];
  screenRelay?: TheoryChain[];
  security?: TheoryChain[];
  tactical?: TheoryChain[];
  passive?: TheoryChain[];
  gatt?: TheoryChain[];
  architecture?: TheoryChain[];
  securitySummary?: Record<string, unknown>;
}

export interface ReplayFrame {
  ts: number;
  count: number;
  maxHopDepth?: number;
}

export interface ReplaySnapshot {
  frames: ReplayFrame[];
}

export interface ScreenRelayRecommendation {
  narrative?: string;
  guessedPlatform?: string;
  gattExfilTier?: string;
  recommendedTheoryId?: string;
  recommendedFix?: string;
  recommendedCode?: string;
  operatorSteps?: string[];
}

export interface ScreenRelaySnapshot {
  recommendation?: ScreenRelayRecommendation;
  honestLimit?: string;
  bindAll?: boolean;
  lanIp?: string;
  frameStore?: Record<string, unknown>;
}

export interface WifiPoseSnapshot {
  story?: { protagonist?: string; subject?: string; scene?: string };
  cmuResearch?: { summary?: string };
  honestLimit?: string;
  fusion?: { fusionSteps?: string[] };
}

export interface ScreenSessionInfo {
  sessionId: string;
}

export interface ScreenSessionResponse {
  ok: boolean;
  session?: ScreenSessionInfo;
  urls?: { relayPage?: string };
  phoneNote?: string;
  error?: string;
}

export interface ScreenFramePayload {
  sessionId: string;
  deviceAddress?: string;
  label?: string;
  frameJpeg: string;
  width: number;
  height: number;
  ts: number;
}

export interface ScreenFrameResponse {
  ok: boolean;
  frameCount?: number;
  error?: string;
}

export interface HopReportPayload {
  scannerId: string;
  label?: string;
  latitude?: number;
  longitude?: number;
  devices: Array<Record<string, unknown>>;
}

export interface ScanTriggerResponse {
  ok?: boolean;
  alreadyRunning?: boolean;
  continuous?: boolean;
  persistent?: boolean;
  error?: string;
}

export interface ScanOptions {
  baseUrl?: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (snapshot: ScanSnapshot) => void;
}

export interface ScanHandle {
  stop: () => Promise<void>;
  getSnapshot: () => ScanSnapshot | null;
}

export interface ConnectOptions {
  optionalServices?: BluetoothServiceUUID[];
  serviceUuid?: BluetoothServiceUUID;
  characteristicUuid?: BluetoothCharacteristicUUID;
  signal?: AbortSignal;
}

export interface ConnectedDevice {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  disconnect: () => void;
  readOnce?: () => Promise<DataView>;
}

export interface WarRoomEvent {
  type: string;
  message: string;
}

const DEFAULT_BASE = "http://127.0.0.1:8765";

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Aborted.");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export class BluetoothClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async checkHealth(): Promise<HealthStatus> {
    return fetchJson<HealthStatus>(`${this.baseUrl}/api/health`);
  }

  public async getDevices(): Promise<ScanSnapshot> {
    return fetchJson<ScanSnapshot>(`${this.baseUrl}/api/devices`);
  }

  public async getTactical(): Promise<TacticalSnapshot> {
    return fetchJson<TacticalSnapshot>(`${this.baseUrl}/api/tactical`);
  }

  public async getHopGraph(): Promise<Record<string, unknown>> {
    return fetchJson(`${this.baseUrl}/api/hop/graph`);
  }

  public async getChrono(): Promise<{ events: TacticalSnapshot["chrono"] }> {
    return fetchJson(`${this.baseUrl}/api/chrono`);
  }

  public async getTheories(): Promise<TheoriesSnapshot> {
    return fetchJson<TheoriesSnapshot>(`${this.baseUrl}/api/theories`);
  }

  public async getReplay(): Promise<ReplaySnapshot> {
    return fetchJson<ReplaySnapshot>(`${this.baseUrl}/api/replay`);
  }

  public async getScenarios(): Promise<ScenarioListResponse> {
    return fetchJson<ScenarioListResponse>(`${this.baseUrl}/api/scenario`);
  }

  public async getDossier(address: string): Promise<Record<string, unknown>> {
    return fetchJson(`${this.baseUrl}/api/dossier?address=${encodeURIComponent(address)}`);
  }

  public async getScreenRelay(address?: string): Promise<ScreenRelaySnapshot> {
    const q = address ? `?address=${encodeURIComponent(address)}` : "";
    return fetchJson<ScreenRelaySnapshot>(`${this.baseUrl}/api/screen/relay${q}`);
  }

  public async getWifiPose(address?: string): Promise<WifiPoseSnapshot> {
    const q = address ? `?address=${encodeURIComponent(address)}` : "";
    return fetchJson<WifiPoseSnapshot>(`${this.baseUrl}/api/wifi/pose${q}`);
  }

  public async getScreenSessions(): Promise<Record<string, unknown>> {
    return fetchJson(`${this.baseUrl}/api/screen/sessions`);
  }

  public latestScreenFrameUrl(sessionId: string, cacheBust = true): string {
    const url = `${this.baseUrl}/api/screen/frame/latest?session=${encodeURIComponent(sessionId)}`;
    return cacheBust ? `${url}&t=${Date.now()}` : url;
  }

  public async createScreenSession(opts: {
    deviceAddress?: string;
    label?: string;
  }): Promise<ScreenSessionResponse> {
    return fetchJson<ScreenSessionResponse>(`${this.baseUrl}/api/screen/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceAddress: opts.deviceAddress,
        label: opts.label,
      }),
    });
  }

  public async postScreenFrame(payload: ScreenFramePayload): Promise<ScreenFrameResponse> {
    return fetchJson<ScreenFrameResponse>(`${this.baseUrl}/api/screen/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  public async reportHop(payload: HopReportPayload): Promise<{ ok: boolean }> {
    return fetchJson(`${this.baseUrl}/api/hop/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  public async setScenario(scenario: ScenarioId): Promise<{ ok: boolean; scenario: Record<string, unknown> }> {
    return fetchJson(`${this.baseUrl}/api/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
  }

  public async toggleWatchlist(address: string): Promise<{ ok: boolean; watchlist: string[] }> {
    return fetchJson(`${this.baseUrl}/api/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, action: "toggle" }),
    });
  }

  public extractionUrl(format: "json" | "zip" | "cipher" = "zip", password?: string): string {
    if (format === "cipher" && password) {
      return `${this.baseUrl}/api/extract?format=cipher&password=${encodeURIComponent(password)}`;
    }
    return `${this.baseUrl}/api/extract?format=${format}`;
  }

  public briefUrl(): string {
    return `${this.baseUrl}/api/brief`;
  }

  public relayPageUrl(sessionId: string, address?: string, label?: string): string {
    const params = new URLSearchParams({ session: sessionId });
    if (address) params.set("address", address);
    if (label) params.set("label", label);
    return `${this.baseUrl}/relay?${params.toString()}`;
  }

  public openWarRoomStream(onEvent: (event: WarRoomEvent) => void): EventSource {
    const es = new EventSource(`${this.baseUrl}/api/events/stream`);
    es.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as WarRoomEvent);
      } catch {
        // ignore malformed events
      }
    };
    return es;
  }

  public async getScannerLocation(): Promise<ScannerLocation> {
    return fetchJson<ScannerLocation>(`${this.baseUrl}/api/location`);
  }

  public async setScannerLocation(
    latitude: number,
    longitude: number,
    accuracyMeters?: number,
  ): Promise<ScannerLocation & { message?: string }> {
    return fetchJson(`${this.baseUrl}/api/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude, longitude, accuracyMeters }),
    });
  }

  public async pullDeviceData(address: string): Promise<PulledDeviceData> {
    return fetchJson<PulledDeviceData>(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  }

  public async triggerScan(): Promise<ScanTriggerResponse> {
    const res = await fetch(`${this.baseUrl}/api/scan`, { method: "POST" });
    const data = (await res.json()) as ScanTriggerResponse;
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }

  public async stopScan(): Promise<{ ok: boolean; persistent?: boolean; message?: string }> {
    const res = await fetch(`${this.baseUrl}/api/stop`, { method: "POST" });
    const data = (await res.json()) as { ok: boolean; persistent?: boolean; message?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }

  public async startScan(opts: ScanOptions = {}): Promise<ScanHandle> {
    assertNotAborted(opts.signal);

    const health = await this.checkHealth();
    if (!health.ready) {
      throw new Error(health.message);
    }

    await this.triggerScan();

    let latest: ScanSnapshot | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const interval = opts.pollIntervalMs ?? 400;

    const pollOnce = async () => {
      assertNotAborted(opts.signal);
      latest = await this.getDevices();
      opts.onUpdate?.(latest);
    };

    await pollOnce();
    timer = setInterval(() => {
      pollOnce().catch(() => {});
    }, interval);

    const stop = async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await this.stopScan().catch(() => {});
      await pollOnce();
    };

    opts.signal?.addEventListener("abort", () => {
      stop().catch(() => {});
    });

    return {
      stop,
      getSnapshot: () => latest,
    };
  }

  public async connectViaBrowser(opts: ConnectOptions = {}): Promise<ConnectedDevice> {
    assertNotAborted(opts.signal);

    if (typeof navigator === "undefined" || !navigator.bluetooth) {
      throw new Error("Web Bluetooth not available in this browser.");
    }

    const bluetooth = navigator.bluetooth;
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: opts.optionalServices ?? [],
    });

    const onGattDisconnected = () => {};
    device.addEventListener("gattserverdisconnected", onGattDisconnected);

    const server = await device.gatt?.connect();
    if (!server) throw new Error("Failed to connect to GATT server.");

    const disconnect = () => {
      device.removeEventListener("gattserverdisconnected", onGattDisconnected);
      try {
        server.disconnect();
      } catch {
        // ignore
      }
    };

    let readOnce: ConnectedDevice["readOnce"];
    if (opts.serviceUuid && opts.characteristicUuid) {
      const serviceUuid = opts.serviceUuid;
      const characteristicUuid = opts.characteristicUuid;
      readOnce = async () => {
        const service = await server.getPrimaryService(serviceUuid);
        const ch = await service.getCharacteristic(characteristicUuid);
        return ch.readValue();
      };
    }

    return { device, server, disconnect, readOnce };
  }
}
