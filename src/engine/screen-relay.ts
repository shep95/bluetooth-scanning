/** Screen relay theories — narrative → flaw → fix → code. */

import { SCREEN_RELAY_THEORIES, type TheoryRecord } from "../ble/theory.js";

export type Platform =
  | "android"
  | "ios"
  | "windows"
  | "macos"
  | "linux"
  | "unknown";

type JsonRecord = Record<string, unknown>;

const THEORY_BY_ID: Record<string, TheoryRecord> = Object.fromEntries(
  SCREEN_RELAY_THEORIES.map((t) => [t.id, t]),
);

const PLATFORM_HINTS: Record<string, string[]> = {
  android: [
    "scrcpy_usb",
    "scrcpy_wifi",
    "chromecast_tab",
    "webrtc_display",
    "companion_frame_relay",
  ],
  ios: [
    "airplay_receiver",
    "quicktime_ios",
    "ios_replaykit",
    "webrtc_display",
    "continuity_camera",
  ],
  windows: [
    "windows_project",
    "miracast_win",
    "rdp_consent",
    "obs_ndi",
    "webrtc_display",
  ],
  macos: ["airplay_receiver", "quicktime_ios", "webrtc_display", "obs_ndi"],
  unknown: ["webrtc_display", "hdmi_capture", "qr_session_pair", "ble_to_wifi_handoff"],
};

export function consentGate(
  operatorOwnsDevice: boolean,
  explicitConsent: boolean,
): JsonRecord {
  const allowed = operatorOwnsDevice || explicitConsent;
  return {
    allowed,
    message: allowed
      ? "Screen relay permitted — use consent-based path below."
      : "BLOCKED — pair device you own or obtain explicit consent before mirroring.",
  };
}

export function guessPlatform(record: JsonRecord): Platform {
  const name = String(record.displayName ?? record.name ?? "").toLowerCase();
  const passive = (record.passiveIntel as JsonRecord | undefined) ?? {};
  const hints = ((passive.ecosystemHints as string[] | undefined) ?? [])
    .join(" ")
    .toLowerCase();
  const pulled = (record.pulledData as JsonRecord | undefined) ?? {};
  const data = (pulled.data as JsonRecord | undefined) ?? {};
  const appearance = String(data.appearance ?? "").toLowerCase();

  if (
    name.includes("iphone") ||
    name.includes("ipad") ||
    hints.includes("apple") ||
    appearance.includes("phone")
  ) {
    return "ios";
  }
  if (
    name.includes("pixel") ||
    name.includes("galaxy") ||
    name.includes("android") ||
    hints.includes("google") ||
    hints.includes("fast pair")
  ) {
    return "android";
  }
  if (
    name.includes("surface") ||
    name.includes("windows") ||
    hints.includes("swift pair")
  ) {
    return "windows";
  }
  if (name.includes("macbook") || name.includes("imac")) {
    return "macos";
  }
  return "unknown";
}

function operatorSteps(platform: Platform, exfilTier: string): string[] {
  const steps = [
    "BLE scan finds the device in tactical HUD (presence only).",
    "GATT pull cannot read screen — expect exfilTier LOCKED on phones.",
  ];
  if (platform === "android") {
    steps.push(
      "Enable USB debugging on the phone → approve RSA fingerprint.",
      "Install scrcpy → run: scrcpy -s <device_serial> (shows on PC monitor).",
      "Or: same Wi‑Fi → adb pair → scrcpy --tcpip.",
    );
  } else if (platform === "ios") {
    steps.push(
      "On iPhone: Control Center → Screen Mirroring → pick AirPlay receiver on PC.",
      "Or: cable to Mac QuickTime, extend display to your monitor.",
      "Or: install cooperative app with ReplayKit (user starts broadcast).",
    );
  } else if (platform === "windows") {
    steps.push(
      "On source laptop: Win+K or Connect → project to this PC.",
      "Or: RDP / RustDesk with user accepting the session.",
    );
  } else {
    steps.push(
      "HUD → SCREEN RELAY → scan QR on phone (same Wi‑Fi, BLE_BIND_ALL=1).",
      "Phone opens /relay → START SHARE → pick screen/window.",
      "Live feed appears on monitor in Screen relay panel.",
      "Or: HDMI capture card from physical video out.",
    );
  }
  if (exfilTier === "LOCKED") {
    steps.splice(
      2,
      0,
      "LOCKED: pair device in Windows Bluetooth first — still won't mirror; use paths above.",
    );
  }
  return steps;
}

export function recommendRelayPath(record: JsonRecord | null = null): JsonRecord {
  const rec = record ?? {};
  const tier = String(rec.exfilTier ?? "PASSIVE_ONLY");
  const platform = guessPlatform(rec);
  const paths = [...(PLATFORM_HINTS[platform] ?? PLATFORM_HINTS.unknown)];

  if (tier === "LOCKED") {
    paths.unshift("locked_phone_path", "ble_to_wifi_handoff");
  }

  const education = ["ble_not_framebuffer", "gatt_screen_blocked", "covert_mirror"];
  const rankedIds: string[] = [];
  for (const tid of [...education, ...paths]) {
    if (!rankedIds.includes(tid)) {
      rankedIds.push(tid);
    }
  }

  const theories = rankedIds
    .filter((tid) => tid in THEORY_BY_ID)
    .map((tid) => THEORY_BY_ID[tid]!);
  const top =
    theories.find((t) => t.feasibility === "high" || t.feasibility === "planned") ??
    (theories.length ? theories[theories.length - 1] : null);

  return {
    narrative: "See another device's screen on your monitor",
    bleCanDo: "Discover device presence, name, RSSI — not pixels",
    gattExfilTier: tier,
    guessedPlatform: platform,
    recommendedTheoryId: top?.id ?? null,
    recommendedFix: top?.fix ?? null,
    recommendedCode: top?.code ?? null,
    operatorSteps: operatorSteps(platform, tier),
    theories,
    consent: consentGate(true, false),
  };
}

export function webrtcRelaySpec(): JsonRecord {
  return {
    endpoint: "POST /api/screen/frame",
    browserApi: "navigator.mediaDevices.getDisplayMedia()",
    relayPage: "/relay?session=...",
    viewer: "GET /api/screen/frame/latest?session=...",
    consent: "Browser shows picker — user chooses window/screen",
    status: "implemented",
  };
}

export function companionRelaySpec(): JsonRecord {
  return {
    pattern: "Browser or companion posts base64 JPEG every 200ms",
    endpoint: "POST /api/screen/frame",
    session: "POST /api/screen/session",
    payload: {
      sessionId: "...",
      deviceAddress: "...",
      frameJpeg: "...",
      ts: 0,
    },
    consent: "User taps START SHARE on /relay page",
    status: "implemented",
  };
}

export function replaykitSpec(): JsonRecord {
  return {
    platform: "iOS",
    api: "RPBroadcastSampleHandler",
    consent: "User starts screen recording from Control Center",
    status: "spec_only",
  };
}

export function qrHandoffSpec(sessionBase = "http://127.0.0.1:8765"): JsonRecord {
  return {
    qrUrl: `${sessionBase}/relay?session={sessionId}`,
    flow: "HUD SCREEN RELAY → QR → phone opens /relay → START SHARE",
    status: "implemented",
  };
}

export function screenRelaySnapshot(device: JsonRecord | null = null): JsonRecord {
  const rec = recommendRelayPath(device);
  return {
    category: "screen_relay",
    count: SCREEN_RELAY_THEORIES.length,
    catalog: SCREEN_RELAY_THEORIES,
    recommendation: rec,
    specs: {
      webrtc: webrtcRelaySpec(),
      companion: companionRelaySpec(),
      replaykit: replaykitSpec(),
      qrHandoff: qrHandoffSpec(),
    },
    honestLimit:
      "No theory bypasses OS consent for arbitrary devices. BLE finds them; Wi‑Fi/USB/HDMI shows them.",
  };
}
