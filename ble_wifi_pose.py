"""PoseSense — WiFi CSI body pose theories (CMU-inspired) + BLE fusion spec.

Narrative arc (Wayne / Dr. Emily lab demo):
  WiFi signals reconstruct full-body pose in a room; fuse with BLE identity tracking.

Honest limit: commodity BLE scanning cannot read WiFi CSI. Pose needs CSI-capable
radios (research NICs, ESP32-S3 CSI, etc.) as cooperative nodes — like hop_reporter.
"""

from __future__ import annotations

from typing import Any

# Carnegie Mellon University WiFi pose research (DensePose-from-WiFi line of work)
CMU_WIFI_POSE_REF = {
    "institution": "Carnegie Mellon University",
    "topic": "WiFi CSI → dense human body pose",
    "summary": (
        "Research demonstrated reconstructing a person's body pose from WiFi channel "
        "state information (CSI) — movement modulates multipath; neural models recover "
        "skeleton / dense pose without cameras in the room."
    ),
    "honestLimit": (
        "Lab conditions, CSI-capable hardware, trained models per environment — "
        "not available from standard Windows BLE scan APIs."
    ),
}

POSE_SENSE_STORY = {
    "protagonist": "Wayne",
    "subject": "Dr. Emily",
    "scene": "Lab demo — subject moves; pose overlays on operator screen in real time",
    "insight": "Combine WiFi pose layer with BLE to detect movement AND identify which device/person",
}

WIFI_POSE_THEORIES: list[dict[str, str]] = [
    {
        "id": "posesense_vision",
        "category": "wifi_pose",
        "narrative": "PoseSense — see body pose on screen as person moves in room",
        "flaw": "BLE advertisements carry no skeleton data",
        "flawType": "technical",
        "fix": "Adjacent WiFi CSI layer; BLE supplies identity + presence",
        "code": "ble_wifi_pose.posesense_snapshot",
        "module": "ble_wifi_pose.py",
        "feasibility": "planned",
    },
    {
        "id": "cmu_wifi_pose",
        "category": "wifi_pose",
        "narrative": "Carnegie Mellon WiFi → full body pose reconstruction",
        "flaw": "Needs CSI from WiFi chipset — most laptop WiFi drivers do not expose it",
        "flawType": "technical",
        "fix": "Document CMU research; deploy CSI-capable cooperative node",
        "code": "ble_wifi_pose.CMU_WIFI_POSE_REF",
        "module": "ble_wifi_pose.py",
        "feasibility": "research",
    },
    {
        "id": "wifi_csi_multipath",
        "category": "wifi_pose",
        "narrative": "Movement ghosts in WiFi multipath",
        "flaw": "CSI is noisy; furniture and walls dominate signal",
        "flawType": "technical",
        "fix": "Multiple APs / antennas + calibrated room model",
        "code": "ble_wifi_pose.multi_ap_spec",
        "module": "ble_wifi_pose.py",
        "feasibility": "research",
    },
    {
        "id": "identity_pose_fusion",
        "category": "wifi_pose",
        "narrative": "Track WHO is moving — pose + individual identity",
        "flaw": "WiFi pose alone is anonymous skeleton; BLE MAC rotates on phones",
        "flawType": "privacy",
        "fix": "Fuse CSI track with BLE fingerprint + hop custody chain",
        "code": "ble_wifi_pose.recommend_pose_fusion",
        "module": "ble_wifi_pose.py",
        "feasibility": "planned",
    },
    {
        "id": "emily_lab_demo",
        "category": "wifi_pose",
        "narrative": "Dr. Emily walks lab — real-time pose on Wayne's screen",
        "flaw": "Demo requires instrumented room + consenting subject",
        "flawType": "ethical",
        "fix": "Cooperative lab scenario only; chrono log + explicit opt-in",
        "code": "ble_wifi_pose.POSE_SENSE_STORY",
        "module": "ble_wifi_pose.py",
        "feasibility": "high",
    },
    {
        "id": "commodity_wifi_block",
        "category": "wifi_pose",
        "narrative": "Use existing PC WiFi for pose",
        "flaw": "Windows WiFi stack does not expose CSI to user apps",
        "flawType": "operational",
        "fix": "ESP32 / research NIC hop node posts pose JSON to /api/wifi/pose",
        "code": "ble_wifi_pose.csi_node_spec",
        "module": "ble_wifi_pose.py",
        "feasibility": "planned",
    },
    {
        "id": "ble_rssi_proxy",
        "category": "wifi_pose",
        "narrative": "Through-wall body tracking today",
        "flaw": "BLE RSSI is not pose — only coarse proximity",
        "flawType": "technical",
        "fix": "tomography_grid + ghost_trail as honest proxy until CSI node online",
        "code": "ble_sci_fi.tomography_grid",
        "module": "ble_sci_fi.py",
        "feasibility": "high",
    },
    {
        "id": "pose_hop_fusion",
        "category": "wifi_pose",
        "narrative": "Domino hop + WiFi pose same battlefield",
        "flaw": "Two radio layers must time-sync",
        "flawType": "architecture",
        "fix": "Merge hop graph nodes with pose tracks by timestamp + room zone",
        "code": "ble_hop_merge.merge_hop_relay_devices",
        "module": "ble_hop_merge.py",
        "feasibility": "planned",
    },
    {
        "id": "pose_surveillance",
        "category": "wifi_pose",
        "narrative": "Covert room surveillance via WiFi",
        "flaw": "Tracking humans without consent is illegal in many jurisdictions",
        "flawType": "legal",
        "fix": "Lab/cooperative subjects only; documented in theory catalog",
        "code": "ble_wifi_pose.consent_gate",
        "module": "ble_wifi_pose.py",
        "feasibility": "forbidden",
    },
    {
        "id": "pose_stream_api",
        "category": "wifi_pose",
        "narrative": "Live skeleton overlay on tactical HUD",
        "flaw": "No CSI ingest pipeline in v1 BLE server",
        "flawType": "technical",
        "fix": "POST /api/wifi/pose frame spec; HUD canvas overlay (planned)",
        "code": "ble-scan-server.Handler.do_POST",
        "module": "ble-scan-server.py",
        "feasibility": "planned",
    },
]


def consent_gate(lab_subject_opt_in: bool = False) -> dict[str, Any]:
    return {
        "allowed": lab_subject_opt_in,
        "message": (
            "PoseSense permitted in instrumented lab with subject consent."
            if lab_subject_opt_in
            else "BLOCKED — WiFi pose tracking requires explicit subject opt-in."
        ),
    }


def multi_ap_spec() -> dict[str, Any]:
    return {
        "minimumAccessPoints": 3,
        "csiRequired": True,
        "note": "Multipath diversity improves pose recovery — single AP is weak",
        "status": "spec_only",
    }


def csi_node_spec() -> dict[str, Any]:
    return {
        "pattern": "Like hop_reporter.py but posts WiFi CSI / pose keypoints",
        "endpoint": "POST /api/wifi/pose",
        "payload": {
            "nodeId": "wifi-csi-1",
            "subjectLabel": "track-1",
            "keypoints": [{"name": "nose", "x": 0.5, "y": 0.3, "z": 1.2}],
            "linkedBleMac": "optional",
            "ts": 0,
        },
        "hardware": ["ESP32 CSI", "Intel 5300 research setup", "Atheros CSI tools"],
        "status": "spec_only",
    }


def recommend_pose_fusion(
    device: dict[str, Any] | None = None,
    hop_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """How Wayne would combine CMU WiFi pose with this BLE stack."""
    device = device or {}
    return {
        "story": POSE_SENSE_STORY,
        "cmuResearch": CMU_WIFI_POSE_REF,
        "bleLayer": {
            "role": "Identity + presence — who carries which emitter",
            "fields": ["fingerprint", "hopDepth", "custody", "rssi"],
            "device": device.get("displayName") or device.get("id"),
        },
        "wifiLayer": {
            "role": "Anonymous skeleton / pose — where bodies move in room",
            "status": "requires CSI cooperative node",
            "spec": csi_node_spec(),
        },
        "fusionSteps": [
            "BLE sweep finds devices (phones, wearables) in room.",
            "CSI node posts pose keypoints to POST /api/wifi/pose.",
            "Correlate pose track velocity with BLE RSSI ghost trail trends.",
            "Promote match when fingerprint stable + pose track co-located.",
            "Render fused track on HUD — pose overlay + BLE callsign.",
        ],
        "proxyUntilCsiOnline": [
            "Use tomography_grid for coarse room heat.",
            "Use vector_pursuit / ghost_trail for approach/recede.",
            "Use hop custody when subject carries phone past hop nodes.",
        ],
        "consent": consent_gate(lab_subject_opt_in=False),
    }


def posesense_snapshot(
    device: dict[str, Any] | None = None,
    hop_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "brand": "houseofasher",
        "codename": "PoseSense",
        "story": POSE_SENSE_STORY,
        "cmuResearch": CMU_WIFI_POSE_REF,
        "theories": WIFI_POSE_THEORIES,
        "count": len(WIFI_POSE_THEORIES),
        "fusion": recommend_pose_fusion(device, hop_graph),
        "specs": {
            "multiAp": multi_ap_spec(),
            "csiNode": csi_node_spec(),
        },
        "honestLimit": (
            "Wayne's PoseSense vision needs WiFi CSI hardware — not BLE alone. "
            "This repo documents the theory chain and BLE+pose fusion path; "
            "CSI ingest is spec-only until a cooperative node is deployed."
        ),
        "status": "theory_and_spec",
    }
