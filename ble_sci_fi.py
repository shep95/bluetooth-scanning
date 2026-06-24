"""#houseofasher sci-fi theories — narrative → flaw → fix → code."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import time
import zipfile
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from ble_device_naming import DeviceSignals, format_mac, normalize_mac, service_uuid_key
from ble_theory import TACTICAL_THEORIES as THEORY_CATALOG, ALL_THEORIES, append_theory_brief

REPLAY_MAX = 120
RESURRECT_GAP_SEC = 45.0
QUORUM_MIN_SCANNERS = 2
COOCCURRENCE_TICK_SEC = 30.0

UUID_CLASS: dict[str, str] = {
    "180D": "WEARABLE",
    "180F": "BATTERY",
    "1812": "HID",
    "110E": "AUDIO",
    "110B": "AUDIO",
    "FE2C": "FAST_PAIR",
    "FE95": "IOT",
    "FEAA": "BEACON",
    "FDAA": "SPEAKER",
}


def _stable_fp(signals: DeviceSignals) -> str:
  mfg = ",".join(str(k) for k in sorted(signals.manufacturer_data))
  body = "|".join([mfg, signals.broadcast_name or "", ",".join(signals.uuids or [])])
  return hashlib.sha256(body.encode()).hexdigest()[:16].upper()


def classify_beacon_dialect(signals: DeviceSignals) -> dict[str, Any]:
    labels: list[str] = []
    for u in signals.uuids or []:
        key = service_uuid_key(u)
        if key in UUID_CLASS:
            labels.append(UUID_CLASS[key])
    if signals.manufacturer_data:
        labels.append("MFG_ADV")
    if not labels:
        labels = ["UNKNOWN_DIALECT"]
    return {
        "dialect": labels[0],
        "dialectTags": sorted(set(labels)),
        "narrative": "Beacon dialect analysis",
        "fix": "Rule-based UUID/manufacturer classification",
    }


def passive_protocol_profile(signals: DeviceSignals) -> dict[str, Any]:
    mfg_ids = [hex(k) for k in sorted(signals.manufacturer_data)]
    return {
        "profileId": f"PRT-{_stable_fp(signals)[:8]}",
        "serviceKeys": [service_uuid_key(u) for u in (signals.uuids or [])],
        "manufacturerIds": mfg_ids,
        "txPower": signals.tx_power,
        "serviceDataKeys": list(signals.service_data_keys or []),
    }


def device_mind_reading(record: dict[str, Any]) -> dict[str, Any]:
    caps: list[str] = []
    uuids = record.get("uuids") or []
    for u in uuids:
        key = service_uuid_key(str(u))
        if key == "180D":
            caps.append("heart_rate")
        elif key == "1812":
            caps.append("hid_input")
        elif key == "180F":
            caps.append("battery_service")
        elif key in ("110E", "110B"):
            caps.append("audio")
    pulled = (record.get("pulledData") or {}).get("data") or {}
    if pulled.get("batteryLevel") is not None:
        caps.append("battery_readable")
    if pulled.get("modelNumber"):
        caps.append("model_disclosed")
    return {
        "capabilities": sorted(set(caps)) or ["unknown"],
        "mindNote": "Inferred from GATT/services — not literal mind reading.",
    }


def vector_pursuit(trail: list[dict[str, Any]]) -> dict[str, Any]:
    if len(trail) < 3:
        return {"velocityDbPerSec": 0, "bearing": "unknown", "confidence": "low"}
    rs = [p["rssi"] for p in trail[-8:] if p.get("rssi") is not None]
    ts = [p["ts"] for p in trail[-8:] if p.get("rssi") is not None]
    if len(rs) < 2 or ts[-1] == ts[0]:
        return {"velocityDbPerSec": 0, "bearing": "unknown", "confidence": "low"}
    vel = (rs[-1] - rs[0]) / max(0.1, ts[-1] - ts[0])
    bearing = "closing" if vel > 0.5 else "opening" if vel < -0.5 else "parallel"
    conf = "high" if abs(vel) > 2 else "medium" if abs(vel) > 0.8 else "low"
    return {"velocityDbPerSec": round(vel, 2), "bearing": bearing, "confidence": conf}


def containment_geofence(record: dict[str, Any], rssi_threshold: int = -62) -> dict[str, Any]:
    rssi = record.get("rssi")
    zone = record.get("proximityZone", "unknown")
    inside = rssi is not None and rssi >= rssi_threshold
    return {
        "insidePerimeter": inside,
        "perimeterRssi": rssi_threshold,
        "zone": zone,
        "breach": inside and record.get("threatTier") in ("unknown", "priority", "breach"),
    }


def echo_ranging(trail: list[dict[str, Any]], hop_obs: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(trail) < 4 or len(hop_obs) < 2:
        return None
    rs = [p["rssi"] for p in trail[-4:] if p.get("rssi") is not None]
    if len(rs) < 2:
        return None
    delta = rs[-1] - rs[0]
    hop_delta = hop_obs[-1].get("rssi", 0) - hop_obs[0].get("rssi", 0) if hop_obs else 0
    trend = "approaching_root" if delta > 3 else "receding_root" if delta < -3 else "stable"
    return {"rootTrend": trend, "rssiDelta": delta, "multiNodeDelta": hop_delta}


def mesh_quorum(mac: str, hop_graph: dict[str, Any], minimum: int = QUORUM_MIN_SCANNERS) -> dict[str, Any]:
    nmac = normalize_mac(mac)
    scanners: set[str] = set()
    for edge in hop_graph.get("edges", []):
        if edge.get("hop") != 1:
            continue
        nodes = {n["id"]: n for n in hop_graph.get("nodes", [])}
        tgt = nodes.get(edge.get("to", ""))
        if not tgt:
            continue
        addr = tgt.get("address", "")
        if addr and normalize_mac(addr) == nmac:
            scanners.add(edge.get("from", ""))
    count = len(scanners)
    return {
        "scannerCount": count,
        "quorumMet": count >= minimum,
        "status": "CONFIRMED" if count >= minimum else "PENDING",
        "scanners": list(scanners),
    }


def shadow_track(fingerprint: str, hop_graph: dict[str, Any], mac: str) -> dict[str, Any]:
    path: list[str] = []
    nmac = normalize_mac(mac)
    nodes = {n["id"]: n for n in hop_graph.get("nodes", [])}
    dev = nodes.get(f"dev:{nmac}")
    if dev and dev.get("pathFromRoot"):
        path = [nodes.get(p, {}).get("label", p) for p in dev["pathFromRoot"]]
    return {"shadowPath": path, "fingerprint": fingerprint, "relayActive": len(path) > 2}


def battery_oracle(record: dict[str, Any], adv_ticks: int) -> dict[str, Any]:
    pulled = (record.get("pulledData") or {}).get("data") or {}
    batt = pulled.get("batteryLevel")
    if batt is not None:
        return {"source": "gatt", "level": batt, "status": "known"}
    cadence = "active" if adv_ticks > 20 else "idle" if adv_ticks > 5 else "dormant"
    return {"source": "inferred", "cadence": cadence, "status": "estimated"}


def tomography_grid(hop_graph: dict[str, Any]) -> list[dict[str, Any]]:
    zones: list[dict[str, Any]] = []
    for scanner in hop_graph.get("scanners", []):
        obs = scanner.get("observationCount", 0)
        zones.append({
            "node": scanner.get("label"),
            "nodeId": scanner.get("nodeId"),
            "heat": min(100, obs * 8),
            "note": "RSSI heat from cooperative scanner — not literal through-wall imaging.",
        })
    return zones


def worm_timeline(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return history[-40:]


def detect_temporal_anomaly(mac: str, hop_depth: int | None, prev: dict[str, int]) -> dict[str, Any] | None:
    if hop_depth is None:
        return None
    nmac = normalize_mac(mac)
    old = prev.get(nmac)
    if old is not None and hop_depth > old + 2:
        return {
            "anomaly": True,
            "message": f"TEMPORAL ANOMALY · hop depth jumped {old} → {hop_depth}",
            "previousDepth": old,
            "currentDepth": hop_depth,
        }
    return None


def detect_clone_clusters(fingerprint_history: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    clusters = []
    for fp, hist in fingerprint_history.items():
        macs = hist.get("macs", [])
        if len(macs) >= 2:
            clusters.append({
                "fingerprint": fp,
                "macCount": len(macs),
                "macs": [format_mac(m) if len(m) == 12 else m for m in macs[:6]],
                "label": "PROBABLE SAME EMITTER (cloned MACs)",
            })
    return clusters


def detect_spoof(
    record: dict[str, Any],
    watchlist_names: dict[str, str],
    fingerprint_by_mac: dict[str, str],
    trusted_prints: set[str],
) -> dict[str, Any] | None:
    name = (record.get("displayName") or "").lower()
    if not name:
        return None
    for trusted in watchlist_names.values():
        if trusted.lower() == name:
            fp = record.get("fingerprint") or fingerprint_by_mac.get(normalize_mac(record.get("id", "")), "")
            if fp and fp not in trusted_prints:
                return {
                    "spoof": True,
                    "message": f"MIMIC ALERT · name '{record.get('displayName')}' with unknown signature",
                    "displayName": record.get("displayName"),
                    "fingerprint": fp,
                }
    return None


def build_cooccurrence_clusters(presence_log: dict[str, set[str]]) -> list[dict[str, Any]]:
    """presence_log: tick_id -> set of macs seen together."""
    pair_counts: dict[tuple[str, str], int] = defaultdict(int)
    for macs in presence_log.values():
        ml = sorted(macs)
        for i, a in enumerate(ml):
            for b in ml[i + 1 :]:
                pair_counts[(a, b)] += 1
    clusters: list[dict[str, Any]] = []
    for (a, b), n in sorted(pair_counts.items(), key=lambda x: -x[1])[:12]:
        if n >= 2:
            clusters.append({"devices": [a, b], "coOccurrences": n, "label": "ASSOCIATED CLUSTER"})
    return clusters


def generate_mission_brief(snapshot: dict[str, Any]) -> str:
    tac = snapshot.get("tactical") or {}
    sci = tac.get("sciFi") or {}
    lines = [
        "# houseofasher MISSION BRIEF",
        f"Mission ID: {tac.get('missionId', '?')}",
        f"Phase: {tac.get('missionLabel', '?')}",
        f"Contacts: {snapshot.get('count', 0)}",
        f"Hop depth: {snapshot.get('hopGraph', {}).get('maxHopDepth', 0)}",
        f"Quorum confirmed: {sci.get('quorumConfirmed', 0)}",
        f"Clone clusters: {len(sci.get('cloneClusters', []))}",
        f"Spoof alerts: {len(sci.get('spoofAlerts', []))}",
        f"Resurrections: {len(sci.get('resurrections', []))}",
        f"Co-occurrence clusters: {len(sci.get('cohortClusters', []))}",
        "",
        "## Domino breach chains",
    ]
    for c in (tac.get("dominoBreaches") or [])[:5]:
        lines.append(f"- {c.get('breachLabel', c.get('target', '?'))}: {' → '.join(c.get('path', []))}")
    lines.extend(["", "## Recent chrono", ""])
    for e in (tac.get("chrono") or [])[-8:]:
        lines.append(f"- [{e.get('type')}] {e.get('message')}")
    append_theory_brief(lines, snapshot.get("devices") or [])
    lines.append("")
    lines.append("_Generated from live BLE sweep — MACs are hardware IDs, not street addresses._")
    return "\n".join(lines)


def encrypt_package(payload: bytes, password: str) -> bytes:
    key = hashlib.sha256(password.encode()).digest()
    scrambled = bytes(b ^ key[i % len(key)] for i, b in enumerate(payload))
    return base64.b64encode(scrambled)


def build_cipher_zip(package: dict[str, Any], password: str) -> bytes:
    raw = json.dumps(package, indent=2, default=str).encode()
    enc = encrypt_package(raw, password)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("mission_intel.enc", enc)
        zf.writestr(
            "README.txt",
            "# houseofasher cipher exfil\nDecrypt mission_intel.enc with /api/decrypt using the same password.\n",
        )
    return buf.getvalue()


@dataclass
class SciFiEngine:
    last_seen: dict[str, float] = field(default_factory=dict)
    lost_marked: set[str] = field(default_factory=set)
    resurrections: list[dict[str, Any]] = field(default_factory=list)
    spoof_alerts: list[dict[str, Any]] = field(default_factory=list)
    custody: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    adv_tick_count: dict[str, int] = field(default_factory=dict)
    hop_depth_prev: dict[str, int] = field(default_factory=dict)
    anomalies: list[dict[str, Any]] = field(default_factory=list)
    presence_ticks: dict[str, set[str]] = field(default_factory=dict)
    last_cooccurrence_tick: float = 0.0
    replay_buffer: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=REPLAY_MAX))
    worm_history: list[dict[str, Any]] = field(default_factory=list)
    trusted_fingerprints: set[str] = field(default_factory=set)
    listening_posts: set[str] = field(default_factory=set)
    team_mode: str = "red_blue"  # friendly=blue, unknown=red

    def reset(self) -> None:
        self.last_seen.clear()
        self.lost_marked.clear()
        self.resurrections.clear()
        self.spoof_alerts.clear()
        self.custody.clear()
        self.adv_tick_count.clear()
        self.hop_depth_prev.clear()
        self.anomalies.clear()
        self.presence_ticks.clear()
        self.last_cooccurrence_tick = 0.0
        self.replay_buffer.clear()
        self.worm_history.clear()

    def register_listening_post(self, node_id: str) -> None:
        self.listening_posts.add(node_id)

    def tick_presence(self, devices: list[dict[str, Any]]) -> None:
        now = time.time()
        if now - self.last_cooccurrence_tick < COOCCURRENCE_TICK_SEC:
            return
        self.last_cooccurrence_tick = now
        tick_id = str(int(now))
        macs = {normalize_mac(d.get("macAddress") or d.get("id", "")) for d in devices}
        macs.discard("")
        self.presence_ticks[tick_id] = macs

    def record_replay_frame(self, snapshot: dict[str, Any]) -> None:
        self.replay_buffer.append({
            "ts": time.time(),
            "count": snapshot.get("count", 0),
            "maxHopDepth": (snapshot.get("hopGraph") or {}).get("maxHopDepth", 0),
            "devices": [
                {"id": d.get("id"), "rssi": d.get("rssi"), "name": d.get("displayName")}
                for d in (snapshot.get("devices") or [])[:20]
            ],
        })

    def record_worm(self, max_depth: int, node_count: int) -> None:
        self.worm_history.append({
            "ts": time.time(),
            "maxHopDepth": max_depth,
            "nodeCount": node_count,
        })
        if len(self.worm_history) > 200:
            self.worm_history = self.worm_history[-200:]

    def analyze_device(
        self,
        signals: DeviceSignals,
        record: dict[str, Any],
        hop_graph: dict[str, Any],
        watchlist_names: dict[str, str],
        fingerprint_by_mac: dict[str, str],
        log_fn: Any,
    ) -> dict[str, Any]:
        mac = format_mac(signals.address)
        nmac = normalize_mac(mac)
        now = time.time()
        fp = record.get("fingerprint") or _stable_fp(signals)
        trail = record.get("ghostTrail") or []

        self.adv_tick_count[nmac] = self.adv_tick_count.get(nmac, 0) + 1

        # Resurrection
        if nmac in self.lost_marked:
            gap = now - self.last_seen.get(nmac, now)
            self.lost_marked.discard(nmac)
            evt = {"mac": mac, "gapSec": round(gap, 1), "name": record.get("displayName")}
            self.resurrections.append(evt)
            log_fn("resurrect", f"SIGNAL RESURRECTED · {record.get('displayName', mac)} after {int(gap)}s", evt)

        self.last_seen[nmac] = now

        hop_depth = record.get("hopDepth")
        anomaly = detect_temporal_anomaly(mac, hop_depth, self.hop_depth_prev)
        if hop_depth is not None:
            self.hop_depth_prev[nmac] = hop_depth
        if anomaly:
            self.anomalies.append({**anomaly, "mac": mac, "ts": now})
            log_fn("anomaly", anomaly["message"], anomaly)

        spoof = detect_spoof(record, watchlist_names, fingerprint_by_mac, self.trusted_fingerprints)
        if spoof:
            self.spoof_alerts.append({**spoof, "ts": now, "mac": mac})
            log_fn("spoof", spoof["message"], spoof)

        hop_obs = []
        tri = record.get("triangulation") or {}
        if tri:
            hop_obs = tri.get("observations") or []

        sci = {
            "dialect": classify_beacon_dialect(signals),
            "protocol": passive_protocol_profile(signals),
            "mind": device_mind_reading(record),
            "pursuit": vector_pursuit(trail),
            "geofence": containment_geofence(record),
            "shadow": shadow_track(fp, hop_graph, mac),
            "echo": echo_ranging(trail, hop_obs),
            "quorum": mesh_quorum(mac, hop_graph),
            "battery": battery_oracle(record, self.adv_tick_count.get(nmac, 0)),
        }
        return sci

    def tick_lost_devices(self, active_macs: set[str], devices_by_mac: dict[str, dict], log_fn: Any) -> None:
        now = time.time()
        for nmac, last in list(self.last_seen.items()):
            if nmac in active_macs:
                continue
            if now - last > RESURRECT_GAP_SEC and nmac not in self.lost_marked:
                self.lost_marked.add(nmac)
                d = devices_by_mac.get(nmac, {})
                log_fn(
                    "lost",
                    f"SIGNAL LOST · {d.get('displayName', format_mac(nmac))}",
                    {"mac": format_mac(nmac), "gapSec": RESURRECT_GAP_SEC},
                )

    def update_custody(self, devices: list[dict[str, Any]], hop_graph: dict[str, Any]) -> None:
        scanners = {s["nodeId"]: s["label"] for s in hop_graph.get("scanners", [])}
        for d in devices:
            nmac = normalize_mac(d.get("macAddress") or d.get("id", ""))
            fp = d.get("fingerprint", "")
            if not nmac:
                continue
            q = mesh_quorum(nmac, hop_graph)
            if not q["scanners"]:
                continue
            sid = q["scanners"][0]
            entry = {
                "ts": time.time(),
                "scanner": scanners.get(sid, sid),
                "scannerId": sid,
                "rssi": d.get("rssi"),
            }
            chain = self.custody.setdefault(fp or nmac, [])
            if not chain or chain[-1].get("scannerId") != sid:
                chain.append(entry)
            if len(chain) > 30:
                self.custody[fp or nmac] = chain[-30:]

    def snapshot(
        self,
        devices: list[dict[str, Any]],
        hop_graph: dict[str, Any],
        fingerprint_history: dict[str, dict[str, Any]],
        fingerprint_by_mac: dict[str, str],
    ) -> dict[str, Any]:
        quorum_confirmed = sum(1 for d in devices if mesh_quorum(d.get("id", ""), hop_graph).get("quorumMet"))
        return {
            "theories": THEORY_CATALOG,
            "teamMode": self.team_mode,
            "cloneClusters": detect_clone_clusters(fingerprint_history),
            "spoofAlerts": self.spoof_alerts[-10:],
            "resurrections": self.resurrections[-10:],
            "anomalies": self.anomalies[-10:],
            "cohortClusters": build_cooccurrence_clusters(self.presence_ticks),
            "custodyChains": {k: v[-5:] for k, v in list(self.custody.items())[:12]},
            "tomography": tomography_grid(hop_graph),
            "wormTimeline": worm_timeline(self.worm_history),
            "replayFrames": list(self.replay_buffer)[-30:],
            "quorumConfirmed": quorum_confirmed,
            "listeningPosts": list(self.listening_posts),
            "narrativeNote": "Sci-fi labels map to honest BLE limits — see /api/theories for narrative→flaw→fix→code.",
            "theoryCount": len(ALL_THEORIES),
        }


SCI_FI = SciFiEngine()
