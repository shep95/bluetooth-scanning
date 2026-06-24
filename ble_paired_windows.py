"""Load paired Bluetooth device names from Windows (registry + WinRT)."""

from __future__ import annotations

import json
import subprocess
import winreg

from ble_device_naming import _decode_registry_string, format_mac, normalize_mac


def load_windows_paired_names() -> dict[str, str]:
    """MAC (normalized) -> name from BTHPORT registry."""
    names: dict[str, str] = {}
    base = r"SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices"
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base) as parent:
            count = winreg.QueryInfoKey(parent)[0]
            for i in range(count):
                key_name = winreg.EnumKey(parent, i)
                try:
                    with winreg.OpenKey(parent, key_name) as device_key:
                        name = None
                        for value_name in ("LEName", "Name"):
                            try:
                                raw, _ = winreg.QueryValueEx(device_key, value_name)
                                decoded = _decode_registry_string(raw)
                                if decoded:
                                    name = decoded
                                    break
                            except OSError:
                                continue
                        if name:
                            names[normalize_mac(key_name)] = name
                except OSError:
                    continue
    except OSError:
        pass
    return names


def _winrt_paired_devices() -> list[dict[str, str]]:
    """Enumerate paired BLE devices via WinRT (current OS pairing DB)."""
    script = r"""
[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices,ContentType=WindowsRuntime] | Out-Null
$selector = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true)
$infos = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector).GetAwaiter().GetResult()
$out = @()
foreach ($info in $infos) {
  try {
    $ble = [Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($info.Id).GetAwaiter().GetResult()
    if ($ble -and $ble.Name) {
      $addr = "{0:X12}" -f [uint64]$ble.BluetoothAddress
      $out += [pscustomobject]@{ address = $addr; name = $ble.Name }
    }
  } catch {}
}
$out | ConvertTo-Json -Compress
"""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return []
        raw = proc.stdout.strip()
        data = json.loads(raw)
        if isinstance(data, dict):
            data = [data]
        return [{"address": format_mac(d["address"]), "name": d["name"]} for d in data if d.get("name")]
    except Exception:
        return []


def load_all_paired_names() -> dict[str, str]:
    """Merged map: normalized MAC -> friendly name."""
    merged = load_windows_paired_names()
    for item in _winrt_paired_devices():
        merged[normalize_mac(item["address"])] = item["name"]
    return merged


def lookup_paired_name(address: str, paired: dict[str, str]) -> str | None:
    return paired.get(normalize_mac(address))


def name_from_paired_values(hint: str | None, paired: dict[str, str]) -> str | None:
    """If hint matches a known paired device name exactly, return it."""
    if not hint:
        return None
    hint_l = hint.strip().lower()
    for name in paired.values():
        if name.strip().lower() == hint_l:
            return name
    return None
