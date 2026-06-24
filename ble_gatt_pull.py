"""Deep GATT exfil — standard characteristics + full service atlas."""

from __future__ import annotations

import asyncio
import struct
import time
from typing import Any, Callable

from bleak import BleakClient

from ble_device_naming import format_mac, service_uuid_key
from ble_theory import GATT_THEORIES as PULL_THEORY_CATALOG

GATT_TIMEOUT_SEC = 14.0
CONNECT_PAUSE_SEC = 0.6
NOTIFY_SAMPLE_SEC = 1.2

READABLE_CHARS: list[tuple[str, str, str, str]] = [
    ("00001800-0000-1000-8000-00805f9b34fb", "00002a00-0000-1000-8000-00805f9b34fb", "deviceName", "text"),
    ("00001800-0000-1000-8000-00805f9b34fb", "00002a01-0000-1000-8000-00805f9b34fb", "appearance", "appearance"),
    ("00001800-0000-1000-8000-00805f9b34fb", "00002a04-0000-1000-8000-00805f9b34fb", "connectionParams", "hex"),
    ("0000180f-0000-1000-8000-00805f9b34fb", "00002a19-0000-1000-8000-00805f9b34fb", "batteryLevel", "battery"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a29-0000-1000-8000-00805f9b34fb", "manufacturerName", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a24-0000-1000-8000-00805f9b34fb", "modelNumber", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a25-0000-1000-8000-00805f9b34fb", "serialNumber", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a26-0000-1000-8000-00805f9b34fb", "firmwareRevision", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a27-0000-1000-8000-00805f9b34fb", "hardwareRevision", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a28-0000-1000-8000-00805f9b34fb", "softwareRevision", "text"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a50-0000-1000-8000-00805f9b34fb", "pnpId", "pnp"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a23-0000-1000-8000-00805f9b34fb", "systemId", "hex"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a2a-0000-1000-8000-00805f9b34fb", "regulatoryCert", "hex"),
    ("00001805-0000-1000-8000-00805f9b34fb", "00002a2b-0000-1000-8000-00805f9b34fb", "currentTime", "hex"),
    ("0000180d-0000-1000-8000-00805f9b34fb", "00002a37-0000-1000-8000-00805f9b34fb", "heartRateBpm", "heart_rate"),
    ("0000180d-0000-1000-8000-00805f9b34fb", "00002a38-0000-1000-8000-00805f9b34fb", "bodySensorLocation", "body_location"),
    ("00001816-0000-1000-8000-00805f9b34fb", "00002a5b-0000-1000-8000-00805f9b34fb", "cscMeasurement", "hex"),
    ("00001814-0000-1000-8000-00805f9b34fb", "00002a53-0000-1000-8000-00805f9b34fb", "rscMeasurement", "hex"),
    ("0000181d-0000-1000-8000-00805f9b34fb", "00002a9e-0000-1000-8000-00805f9b34fb", "weightMeasurement", "hex"),
    ("0000181b-0000-1000-8000-00805f9b34fb", "00002a9c-0000-1000-8000-00805f9b34fb", "bodyComposition", "hex"),
    ("00001808-0000-1000-8000-00805f9b34fb", "00002a18-0000-1000-8000-00805f9b34fb", "glucoseMeasurement", "hex"),
    ("0000180f-0000-1000-8000-00805f9b34fb", "00002a1a-0000-1000-8000-00805f9b34fb", "batteryLevelState", "hex"),
]

APPEARANCE_MAP: dict[int, str] = {
    0x0040: "Phone",
    0x0080: "Computer",
    0x0140: "Watch",
    0x03C0: "Audio",
    0x03C1: "Headphones",
    0x0540: "HID",
    0x0940: "Blood Pressure",
    0x0980: "Cycling",
    0x0A40: "Pulse Oximeter",
}

BODY_LOCATION_MAP = {
    0: "Other",
    1: "Chest",
    2: "Wrist",
    3: "Finger",
    4: "Hand",
    5: "Ear lobe",
    6: "Foot",
}

CHAR_LABELS: dict[str, str] = {
    "deviceName": "Device name",
    "appearance": "Appearance class",
    "connectionParams": "Connection params",
    "batteryLevel": "Battery %",
    "batteryLevelState": "Battery state",
    "manufacturerName": "Manufacturer",
    "modelNumber": "Model",
    "serialNumber": "Serial",
    "firmwareRevision": "Firmware",
    "hardwareRevision": "Hardware",
    "softwareRevision": "Software",
    "pnpId": "PnP ID",
    "systemId": "System ID",
    "regulatoryCert": "Regulatory cert",
    "currentTime": "Current time",
    "heartRateBpm": "Heart rate (BPM)",
    "bodySensorLocation": "Body sensor location",
    "cscMeasurement": "Cycling speed/cadence",
    "rscMeasurement": "Running speed/cadence",
    "weightMeasurement": "Weight",
    "bodyComposition": "Body composition",
    "glucoseMeasurement": "Glucose",
    "osDeviceName": "OS device name",
    "resolvedAddress": "Identity MAC",
}


def _char_short(uuid: str) -> str:
    u = uuid.lower().replace("-", "")
    if len(u) == 32:
        return u[4:8]
    return u


def _decode_value(key: str, kind: str, raw: bytearray) -> Any:
    if kind == "battery" and len(raw) >= 1:
        return int(raw[0])
    if kind == "appearance" and len(raw) >= 2:
        val = struct.unpack("<H", raw[:2])[0]
        return APPEARANCE_MAP.get(val, f"0x{val:04X}")
    if kind == "pnp" and len(raw) >= 7:
        vid_source = raw[0]
        vid = struct.unpack("<H", raw[1:3])[0]
        pid = struct.unpack("<H", raw[3:5])[0]
        ver = struct.unpack("<H", raw[5:7])[0]
        return f"vendor=0x{vid:04X} product=0x{pid:04X} ver=0x{ver:04X} src={vid_source}"
    if kind == "heart_rate" and len(raw) >= 1:
        flags = raw[0]
        if flags & 0x01 and len(raw) >= 3:
            return struct.unpack("<H", raw[1:3])[0] & 0x1FFF
        if len(raw) >= 2:
            return int(raw[1])
        return None
    if kind == "body_location" and len(raw) >= 1:
        return BODY_LOCATION_MAP.get(raw[0], f"code {raw[0]}")
    if kind == "text":
        text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
        return text or None
    if kind == "hex":
        return raw.hex() if raw else None
    text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    return text or raw.hex()


async def _try_notify_sample(client: BleakClient, char_uuid: str, key: str) -> Any:
    queue: asyncio.Queue[bytearray] = asyncio.Queue()

    def _handler(_handle: int, data: bytearray) -> None:
        queue.put_nowait(data)

    try:
        await client.start_notify(char_uuid, _handler)
        try:
            raw = await asyncio.wait_for(queue.get(), timeout=NOTIFY_SAMPLE_SEC)
            kind = "heart_rate" if key == "heartRateBpm" else "hex"
            return _decode_value(key, kind, raw)
        except asyncio.TimeoutError:
            return None
        finally:
            await client.stop_notify(char_uuid)
    except Exception:
        return None


async def _build_gatt_atlas(client: BleakClient) -> list[dict[str, Any]]:
    atlas: list[dict[str, Any]] = []
    for service in client.services:
        svc_entry: dict[str, Any] = {
            "uuid": str(service.uuid),
            "key": service_uuid_key(str(service.uuid)),
            "characteristics": [],
        }
        for char in service.characteristics:
            props = list(char.properties)
            entry: dict[str, Any] = {
                "uuid": str(char.uuid),
                "key": _char_short(str(char.uuid)),
                "properties": props,
            }
            if "read" in props:
                try:
                    raw = await client.read_gatt_char(char.uuid)
                    entry["valueHex"] = raw.hex()
                    if len(raw) <= 32:
                        entry["valueText"] = raw.decode("utf-8", errors="ignore").strip() or None
                except Exception as exc:
                    entry["readError"] = str(exc)[:80]
            svc_entry["characteristics"].append(entry)
        atlas.append(svc_entry)
    return atlas


def _exfil_tier(pulled: dict[str, Any], atlas: list[dict[str, Any]], errors: list[str]) -> str:
    if pulled.get("heartRateBpm") or pulled.get("batteryLevel") is not None:
        return "PARTIAL"
    if len(atlas) > 2 and pulled:
        return "PARTIAL"
    if errors and not pulled:
        return "LOCKED"
    if pulled:
        return "OPEN"
    return "UNKNOWN"


def _intel_summary(pulled: dict[str, Any], atlas: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for key in (
        "osDeviceName", "deviceName", "appearance", "batteryLevel", "manufacturerName",
        "modelNumber", "heartRateBpm", "bodySensorLocation", "pnpId", "firmwareRevision",
    ):
        if pulled.get(key) is not None:
            label = CHAR_LABELS.get(key, key)
            lines.append(f"{label}: {pulled[key]}")
    lines.append(f"GATT services mapped: {len(atlas)}")
    return lines


async def pull_device_data(address: str) -> dict[str, Any]:
    pulled: dict[str, Any] = {}
    errors: list[str] = []
    atlas: list[dict[str, Any]] = []

    try:
        async with BleakClient(address, timeout=GATT_TIMEOUT_SEC) as client:
            if not client.is_connected:
                errors.append("Could not connect to device")
                return _result(address, pulled, errors, atlas)

            await asyncio.sleep(CONNECT_PAUSE_SEC)

            try:
                os_name = client.name
                if os_name and os_name.strip():
                    pulled["osDeviceName"] = os_name.strip()
            except Exception as exc:
                errors.append(f"osDeviceName: {exc}")

            try:
                resolved = format_mac(client.address)
                if resolved:
                    pulled["resolvedAddress"] = resolved
            except Exception as exc:
                errors.append(f"resolvedAddress: {exc}")

            for _svc, char_uuid, key, kind in READABLE_CHARS:
                if key in pulled and kind not in ("hex",):
                    continue
                try:
                    raw = await client.read_gatt_char(char_uuid)
                    value = _decode_value(key, kind, raw)
                    if value is not None:
                        pulled[key] = value
                except Exception as exc:
                    errors.append(f"{key}: {exc}")

            if "heartRateBpm" not in pulled:
                hr = await _try_notify_sample(
                    client, "00002a37-0000-1000-8000-00805f9b34fb", "heartRateBpm"
                )
                if hr is not None:
                    pulled["heartRateBpm"] = hr

            atlas = await _build_gatt_atlas(client)

    except Exception as exc:
        return _result(address, pulled, [str(exc)], atlas)

    return _result(address, pulled, errors, atlas)


def _result(
    address: str,
    pulled: dict[str, Any],
    errors: list[str],
    atlas: list[dict[str, Any]],
) -> dict[str, Any]:
    tier = _exfil_tier(pulled, atlas, errors)
    return {
        "ok": bool(pulled or atlas),
        "address": address,
        "data": pulled,
        "gattAtlas": atlas,
        "exfilTier": tier,
        "intelSummary": _intel_summary(pulled, atlas),
        "charLabels": CHAR_LABELS,
        "errors": errors[:12],
        "pulledAt": int(time.time() * 1000),
        "narrative": "Deep GATT exfil + service atlas",
        "flaw": "Many phones block unknown connections",
        "fix": "Read standard chars + enumerate all services",
    }


async def pull_devices_sequential(
    addresses: list[str],
    on_each: Callable[[str, dict[str, Any]], None] | None = None,
) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for address in addresses:
        result = await pull_device_data(address)
        results[address] = result
        if on_each:
            on_each(address, result)
        await asyncio.sleep(0.35)
    return results


def pull_device_data_sync(address: str) -> dict[str, Any]:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(pull_device_data(address))
    finally:
        loop.close()
