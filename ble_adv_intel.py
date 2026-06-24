"""Passive advertisement intelligence — beacons, flags, manufacturer hints."""

from __future__ import annotations

import struct
from typing import Any

from ble_device_naming import COMPANY_NAMES, DeviceSignals, service_uuid_key


def _hex(b: bytes | None, limit: int = 48) -> str | None:
    if not b:
        return None
    h = b.hex()
    return h[:limit] + ("…" if len(h) > limit else "")


def parse_ibeacon(mfg: bytes) -> dict[str, Any] | None:
    if len(mfg) < 23 or mfg[0:2] != b"\x4c\x00":
        return None
    if mfg[2] != 0x02 or mfg[3] != 0x15:
        return None
    uuid = mfg[4:20].hex()
    major = struct.unpack(">H", mfg[20:22])[0]
    minor = struct.unpack(">H", mfg[22:24])[0]
    tx = struct.unpack("b", mfg[24:25])[0]
    return {
        "type": "iBeacon",
        "uuid": uuid,
        "major": major,
        "minor": minor,
        "txPower": tx,
        "label": f"iBeacon {major}.{minor}",
    }


def parse_eddystone(service_bytes: bytes) -> dict[str, Any] | None:
    if not service_bytes:
        return None
    frame = service_bytes[0]
    if frame == 0x00 and len(service_bytes) >= 18:
        return {"type": "eddystone_uid", "label": "Eddystone-UID", "raw": _hex(service_bytes)}
    if frame == 0x10:
        return {"type": "eddystone_url", "label": "Eddystone-URL", "raw": _hex(service_bytes)}
    if frame == 0x20:
        return {"type": "eddystone_tlm", "label": "Eddystone-TLM", "raw": _hex(service_bytes)}
    if frame == 0x40:
        return {"type": "eddystone_eid", "label": "Eddystone-EID", "raw": _hex(service_bytes)}
    return None


def parse_apple_mfg(mfg: bytes) -> list[str]:
    hints: list[str] = []
    if len(mfg) < 2 or mfg[0:2] != b"\x4c\x00":
        return hints
    if len(mfg) >= 4 and mfg[2] == 0x0F:
        hints.append("Apple Nearby / Handoff hint")
    if len(mfg) >= 4 and mfg[2] == 0x10:
        hints.append("Apple AirDrop / AWDL hint")
    if len(mfg) >= 4 and mfg[2] in (0x05, 0x09):
        hints.append("Apple Find My / continuity")
    return hints


def parse_microsoft_mfg(mfg: bytes) -> list[str]:
    if len(mfg) < 2 or mfg[0:2] != b"\x06\x00":
        return []
    return ["Microsoft Swift Pair / BLE pairable"]


def parse_google_fast_pair(mfg: bytes) -> list[str]:
    if len(mfg) >= 3 and mfg[0:2] in (b"\xe0\x00", b"\x8e\x01"):
        return ["Google Fast Pair"]
    return []


def build_passive_intel(signals: DeviceSignals) -> dict[str, Any]:
    mfg_hints: list[str] = []
    mfg_records: list[dict[str, Any]] = []
    beacons: list[dict[str, Any]] = []

    for company_id, raw in signals.manufacturer_data.items():
        name = COMPANY_NAMES.get(company_id, f"Company 0x{company_id:04X}")
        mfg_records.append({
            "companyId": f"0x{company_id:04X}",
            "companyName": name,
            "hex": _hex(raw),
        })
        ibeacon = parse_ibeacon(raw)
        if ibeacon:
            beacons.append(ibeacon)
        mfg_hints.extend(parse_apple_mfg(raw))
        mfg_hints.extend(parse_microsoft_mfg(raw))
        mfg_hints.extend(parse_google_fast_pair(raw))

    for _key, raw in (signals.service_data or {}).items():
        edd = parse_eddystone(raw)
        if edd:
            beacons.append(edd)

    service_labels = [service_uuid_key(u) for u in signals.uuids]
    connectable = "likely_connectable" if (signals.broadcast_name or signals.uuids) else "unknown"

    return {
        "theoryId": "adv_archaeology",
        "narrative": "Passive advertisement archaeology",
        "flaw": "Payloads are vendor-opaque without connect",
        "flawType": "technical",
        "fix": "Parse known Apple/Microsoft/Eddystone/iBeacon layouts",
        "code": "ble_adv_intel.build_passive_intel",
        "manufacturerRecords": mfg_records,
        "ecosystemHints": sorted(set(mfg_hints)),
        "beacons": beacons,
        "serviceDataKeys": list(signals.service_data_keys or []),
        "serviceLabels": service_labels,
        "connectableGuess": connectable,
        "txPower": signals.tx_power,
        "broadcastName": signals.broadcast_name,
    }
