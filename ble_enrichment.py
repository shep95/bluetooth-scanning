"""Merge naming, distance, location context, and pulled GATT data into device records."""

from __future__ import annotations

from typing import Any

from ble_device_naming import DeviceSignals, format_mac, normalize_mac, resolve_name, signals_to_record
from ble_distance import distance_payload
from ble_location import ScannerLocation, location_context_for_device
from ble_paired_windows import lookup_paired_name, name_from_paired_values
from ble_tactical import TACTICAL


def rssi_human(rssi: int | None) -> str:
    if rssi is None:
        return "Signal strength unknown"
    if rssi >= -55:
        return "Very strong signal — likely same room"
    if rssi >= -70:
        return "Strong signal — nearby"
    if rssi >= -85:
        return "Moderate signal — farther away"
    return "Weak signal — far away or blocked by walls"


def display_name_from_pull(
    pulled_data: dict[str, Any] | None,
    paired_names: dict[str, str],
) -> tuple[str, str] | None:
    if not pulled_data:
        return None

    data = pulled_data.get("data") or {}

    # Windows OS name after connect — most reliable for paired phones.
    os_name = data.get("osDeviceName")
    if isinstance(os_name, str) and os_name.strip():
        return os_name.strip(), "paired"

    resolved = data.get("resolvedAddress")
    if isinstance(resolved, str):
        paired = lookup_paired_name(resolved, paired_names)
        if paired:
            return paired, "paired"

    name = data.get("deviceName")
    if isinstance(name, str) and name.strip():
        matched = name_from_paired_values(name, paired_names)
        return (matched or name.strip()), "gatt" if not matched else "paired"

    mfg = data.get("manufacturerName")
    model = data.get("modelNumber")
    if mfg and model:
        return f"{mfg} {model}", "gatt"
    if mfg:
        return str(mfg), "gatt"
    if model:
        return str(model), "gatt"

    if pulled_data.get("ok") and os_name:
        return str(os_name), "paired"

    return None


def build_device_record(
    signals: DeviceSignals,
    paired_names: dict[str, str],
    scanner: ScannerLocation,
    pulled_data: dict[str, Any] | None = None,
    hop_depth: int | None = None,
    hop_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = signals_to_record(signals, paired_names)
    resolved = resolve_name(signals, paired_names)
    pulled_name = display_name_from_pull(pulled_data, paired_names)

    if pulled_name:
        record["displayName"], record["nameSource"] = pulled_name[0], pulled_name[1]
        record["name"] = pulled_name[0]
    else:
        record["displayName"] = resolved.display_name
        record["name"] = resolved.display_name
        record["nameSource"] = resolved.name_source

    dist = distance_payload(signals.rssi, signals.tx_power)
    record.update(dist)
    record["rssiHuman"] = rssi_human(signals.rssi)
    record["rssiNote"] = (
        "RSSI = signal strength in dBm. Closer to 0 is stronger (e.g. -45 is close, -85 is far)."
    )
    record["macAddress"] = format_mac(signals.address)
    record["macNote"] = "Bluetooth MAC is a hardware ID — not a street address."
    if pulled_data and pulled_data.get("data", {}).get("resolvedAddress"):
        record["identityAddress"] = pulled_data["data"]["resolvedAddress"]
        record["identityNote"] = "Identity address resolved after connecting (may differ from random BLE MAC while scanning)."
    record["location"] = location_context_for_device(dist["distanceMeters"], scanner)
    record["pulledData"] = pulled_data
    if pulled_data is None:
        record["pullStatus"] = "pending"
    elif pulled_data.get("ok"):
        record["pullStatus"] = "ok"
    elif pulled_data.get("errors"):
        record["pullStatus"] = "failed"
    else:
        record["pullStatus"] = "empty"

    tactical = TACTICAL.on_device_update(signals, record, hop_depth, hop_graph, paired_names)
    record.update(tactical)
    if hop_graph:
        tri = TACTICAL.build_dossier(record, hop_graph).get("triangulation")
        if tri:
            record["triangulation"] = tri
    return record


def remember_paired_aliases(
    paired_names: dict[str, str],
    scan_address: str,
    pulled_data: dict[str, Any] | None,
) -> None:
    """Cache name for random BLE MAC -> identity after a successful connect."""
    if not pulled_data:
        return
    data = pulled_data.get("data") or {}
    name = data.get("osDeviceName")
    if not name:
        name = display_name_from_pull(pulled_data, paired_names)
        name = name[0] if name else None
    if not name:
        return
    paired_names[normalize_mac(scan_address)] = name
    resolved = data.get("resolvedAddress")
    if resolved:
        paired_names[normalize_mac(resolved)] = name
