"""Merge hop scanner observations into the root mapper's unified device list."""

from __future__ import annotations

from typing import Any

from ble_device_naming import format_mac, normalize_mac
from ble_location import SCANNER_LOCATION


def _best_observation_for_device(
    dev_id: str,
    hop_graph: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, int | None]:
    """Return (scanner_meta, via_scanner_id, rssi) for a device node."""
    nodes = {n["id"]: n for n in hop_graph.get("nodes", [])}
    best_rssi: int | None = None
    via: str | None = None
    for edge in hop_graph.get("edges", []):
        if edge.get("to") != dev_id or edge.get("hop") != 1:
            continue
        rssi = edge.get("rssi")
        if rssi is None:
            via = edge.get("viaScanner") or edge.get("from")
            continue
        if best_rssi is None or rssi > best_rssi:
            best_rssi = rssi
            via = edge.get("viaScanner") or edge.get("from")
    scanner = nodes.get(via or "", {})
    return scanner if via else None, via, best_rssi


def merge_hop_relay_devices(
    device_list: list[dict[str, Any]],
    hop_graph: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Every cooperative hop scanner POSTs observations to the root mapper.
    Devices only heard by hop nodes (not root radio) are synthesized here so
    the HUD contact list matches the domino graph.
    """
    if not hop_graph:
        return device_list

    existing = {normalize_mac(d.get("macAddress") or d.get("id", "")) for d in device_list}
    scanners = {s["nodeId"]: s for s in hop_graph.get("scanners", [])}
    merged = list(device_list)

    for node in hop_graph.get("nodes", []):
        if node.get("kind") not in ("device", "bridge"):
            continue
        addr = node.get("address")
        if not addr:
            continue
        nmac = normalize_mac(addr)
        if not nmac or nmac in existing:
            continue

        scanner_meta, via_id, rssi = _best_observation_for_device(node["id"], hop_graph)
        scanner_label = (scanner_meta or {}).get("label") or via_id or "hop node"
        hop_depth = node.get("hopDepth")
        path_ids = node.get("pathFromRoot") or []
        nodes_by_id = {n["id"]: n for n in hop_graph.get("nodes", [])}
        path_labels = [nodes_by_id.get(p, {}).get("label", p) for p in path_ids]

        merged.append({
            "id": format_mac(addr),
            "macAddress": format_mac(addr),
            "displayName": node.get("label") or format_mac(addr),
            "name": node.get("label") or format_mac(addr),
            "nameSource": "hop_relay",
            "rssi": rssi,
            "rssiHuman": "Relayed via hop scanner — not heard by root radio" if rssi is None else None,
            "hopDepth": hop_depth,
            "hopPath": path_labels,
            "reportedByScanner": scanner_label,
            "reportedByScannerId": via_id,
            "hopRelayOnly": True,
            "exfilTier": "PASSIVE_ONLY",
            "pullStatus": "hop_relay",
            "distanceLabel": "Via hop relay",
            "proximityZone": "unknown",
            "threatTier": "breach" if hop_depth and hop_depth >= 3 else "unknown",
            "location": {
                "coLocated": False,
                "contextNote": (
                    f"Heard by hop scanner '{scanner_label}' and merged into root map — "
                    "not directly observed by this PC radio."
                ),
            },
            "passiveIntel": {
                "narrative": "Hop relay observation",
                "flaw": "No live adv packets on root scanner",
                "fix": "Cooperative hop_reporter POST /api/hop/report",
                "connectableGuess": "unknown",
            },
            "lastSeen": int((node.get("lastSeen") or 0) * 1000) if node.get("lastSeen") else None,
        })
        existing.add(nmac)

    # Annotate root-heard devices with who else reported them
    for d in merged:
        nmac = normalize_mac(d.get("macAddress") or d.get("id", ""))
        reporters: list[str] = []
        dev_id = f"dev:{nmac}"
        for edge in hop_graph.get("edges", []):
            if edge.get("to") == dev_id and edge.get("hop") == 1:
                sid = edge.get("viaScanner") or edge.get("from")
                if sid and sid != "pc-root":
                    label = scanners.get(sid, {}).get("label", sid)
                    if label not in reporters:
                        reporters.append(label)
        if reporters:
            d["alsoReportedBy"] = reporters

    merged.sort(
        key=lambda d: (
            d.get("hopDepth") if d.get("hopDepth") is not None else 999,
            -(d.get("rssi") if d.get("rssi") is not None else -999),
        ),
    )
    return merged


def hop_relay_summary(hop_graph: dict[str, Any], device_list: list[dict[str, Any]]) -> dict[str, Any]:
    relay_only = sum(1 for d in device_list if d.get("hopRelayOnly"))
    scanners = hop_graph.get("scanners", [])
    reporting = [s for s in scanners if s.get("observationCount", 0) > 0]
    return {
        "rootMapper": "This PC",
        "reportingScanners": len(reporting),
        "totalScanners": len(scanners),
        "relayOnlyContacts": relay_only,
        "directContacts": len(device_list) - relay_only,
        "note": "Each cooperative scanner POSTs every device it hears; root merges all into one map.",
    }
