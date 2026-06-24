"""Pull permitted GATT data from a BLE device to the local dashboard."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from bleak import BleakClient

from ble_device_naming import format_mac

GATT_TIMEOUT_SEC = 12.0
CONNECT_PAUSE_SEC = 0.6

# service_uuid, char_uuid, field_key
READABLE_CHARS: list[tuple[str, str, str]] = [
    ("00001800-0000-1000-8000-00805f9b34fb", "00002a00-0000-1000-8000-00805f9b34fb", "deviceName"),
    ("0000180f-0000-1000-8000-00805f9b34fb", "00002a19-0000-1000-8000-00805f9b34fb", "batteryLevel"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a29-0000-1000-8000-00805f9b34fb", "manufacturerName"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a24-0000-1000-8000-00805f9b34fb", "modelNumber"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a25-0000-1000-8000-00805f9b34fb", "serialNumber"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a26-0000-1000-8000-00805f9b34fb", "firmwareRevision"),
    ("0000180a-0000-1000-8000-00805f9b34fb", "00002a27-0000-1000-8000-00805f9b34fb", "hardwareRevision"),
]

SHORT_CHAR_MAP = {
    "2a00": "deviceName",
    "2a19": "batteryLevel",
    "2a29": "manufacturerName",
    "2a24": "modelNumber",
    "2a25": "serialNumber",
    "2a26": "firmwareRevision",
    "2a27": "hardwareRevision",
}


def _decode_value(key: str, raw: bytearray) -> Any:
    if key == "batteryLevel" and len(raw) >= 1:
        return int(raw[0])
    text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    return text or None


def _char_key(uuid: str) -> str | None:
    u = uuid.lower().replace("-", "")
    if len(u) == 4:
        return SHORT_CHAR_MAP.get(u)
    if len(u) == 32:
        return SHORT_CHAR_MAP.get(u[4:8])
    return None


async def pull_device_data(address: str) -> dict[str, Any]:
    pulled: dict[str, Any] = {}
    errors: list[str] = []

    try:
        async with BleakClient(address, timeout=GATT_TIMEOUT_SEC) as client:
            if not client.is_connected:
                errors.append("Could not connect to device")
                return _result(address, pulled, errors)

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

            for _service_uuid, char_uuid, key in READABLE_CHARS:
                if key in pulled:
                    continue
                try:
                    raw = await client.read_gatt_char(char_uuid)
                    value = _decode_value(key, raw)
                    if value is not None:
                        pulled[key] = value
                except Exception as exc:
                    errors.append(f"{key}: {exc}")

            # Fallback: read any other standard readable characteristics discovered.
            for service in client.services:
                for char in service.characteristics:
                    if "read" not in char.properties:
                        continue
                    key = _char_key(char.uuid)
                    if not key or key in pulled:
                        continue
                    try:
                        raw = await client.read_gatt_char(char.uuid)
                        value = _decode_value(key, raw)
                        if value is not None:
                            pulled[key] = value
                    except Exception as exc:
                        errors.append(f"{key}: {exc}")

    except Exception as exc:
        return _result(address, pulled, [str(exc)])

    return _result(address, pulled, errors)


def _result(address: str, pulled: dict[str, Any], errors: list[str]) -> dict[str, Any]:
    return {
        "ok": bool(pulled),
        "address": address,
        "data": pulled,
        "errors": errors[:5],
        "pulledAt": int(time.time() * 1000),
    }


async def pull_devices_sequential(
    addresses: list[str],
    on_each: Callable[[str, dict[str, Any]], None] | None = None,
) -> dict[str, dict[str, Any]]:
    """Connect to one device at a time (required on Windows) and pull data."""
    results: dict[str, dict[str, Any]] = {}
    for address in addresses:
        result = await pull_device_data(address)
        results[address] = result
        if on_each:
            on_each(address, result)
        await asyncio.sleep(0.3)
    return results


def pull_device_data_sync(address: str) -> dict[str, Any]:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(pull_device_data(address))
    finally:
        loop.close()
