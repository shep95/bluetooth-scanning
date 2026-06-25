/** PoseSense — WiFi CSI body pose theories (CMU-inspired) + BLE fusion spec. */

import { WIFI_POSE_THEORIES } from "../ble/theory.js";

type JsonRecord = Record<string, unknown>;

export const CMU_WIFI_POSE_REF = {
  institution: "Carnegie Mellon University",
  topic: "WiFi CSI → dense human body pose",
  summary:
    "Research demonstrated reconstructing a person's body pose from WiFi channel " +
    "state information (CSI) — movement modulates multipath; neural models recover " +
    "skeleton / dense pose without cameras in the room.",
  honestLimit:
    "Lab conditions, CSI-capable hardware, trained models per environment — " +
    "not available from standard Windows BLE scan APIs.",
} as const;

export const POSE_SENSE_STORY = {
  protagonist: "Wayne",
  subject: "Dr. Emily",
  scene: "Lab demo — subject moves; pose overlays on operator screen in real time",
  insight:
    "Combine WiFi pose layer with BLE to detect movement AND identify which device/person",
} as const;

export function consentGate(labSubjectOptIn = false): JsonRecord {
  return {
    allowed: labSubjectOptIn,
    message: labSubjectOptIn
      ? "PoseSense permitted in instrumented lab with subject consent."
      : "BLOCKED — WiFi pose tracking requires explicit subject opt-in.",
  };
}

export function multiApSpec(): JsonRecord {
  return {
    minimumAccessPoints: 3,
    csiRequired: true,
    note: "Multipath diversity improves pose recovery — single AP is weak",
    status: "spec_only",
  };
}

export function csiNodeSpec(): JsonRecord {
  return {
    pattern: "Like hop_reporter.py but posts WiFi CSI / pose keypoints",
    endpoint: "POST /api/wifi/pose",
    payload: {
      nodeId: "wifi-csi-1",
      subjectLabel: "track-1",
      keypoints: [{ name: "nose", x: 0.5, y: 0.3, z: 1.2 }],
      linkedBleMac: "optional",
      ts: 0,
    },
    hardware: ["ESP32 CSI", "Intel 5300 research setup", "Atheros CSI tools"],
    status: "spec_only",
  };
}

export function recommendPoseFusion(
  device: JsonRecord | null = null,
  _hopGraph: JsonRecord | null = null,
): JsonRecord {
  const dev = device ?? {};
  return {
    story: POSE_SENSE_STORY,
    cmuResearch: CMU_WIFI_POSE_REF,
    bleLayer: {
      role: "Identity + presence — who carries which emitter",
      fields: ["fingerprint", "hopDepth", "custody", "rssi"],
      device: dev.displayName ?? dev.id,
    },
    wifiLayer: {
      role: "Anonymous skeleton / pose — where bodies move in room",
      status: "requires CSI cooperative node",
      spec: csiNodeSpec(),
    },
    fusionSteps: [
      "BLE sweep finds devices (phones, wearables) in room.",
      "CSI node posts pose keypoints to POST /api/wifi/pose.",
      "Correlate pose track velocity with BLE RSSI ghost trail trends.",
      "Promote match when fingerprint stable + pose track co-located.",
      "Render fused track on HUD — pose overlay + BLE callsign.",
    ],
    proxyUntilCsiOnline: [
      "Use tomography_grid for coarse room heat.",
      "Use vector_pursuit / ghost_trail for approach/recede.",
      "Use hop custody when subject carries phone past hop nodes.",
    ],
    consent: consentGate(false),
  };
}

export function posesenseSnapshot(
  device: JsonRecord | null = null,
  hopGraph: JsonRecord | null = null,
): JsonRecord {
  return {
    brand: "houseofasher",
    codename: "PoseSense",
    story: POSE_SENSE_STORY,
    cmuResearch: CMU_WIFI_POSE_REF,
    theories: WIFI_POSE_THEORIES,
    count: WIFI_POSE_THEORIES.length,
    fusion: recommendPoseFusion(device, hopGraph),
    specs: {
      multiAp: multiApSpec(),
      csiNode: csiNodeSpec(),
    },
    honestLimit:
      "Wayne's PoseSense vision needs WiFi CSI hardware — not BLE alone. " +
      "This repo documents the theory chain and BLE+pose fusion path; " +
      "CSI ingest is spec-only until a cooperative node is deployed.",
    status: "theory_and_spec",
  };
}
