/** Load paired Bluetooth device names from Windows (registry + WinRT). */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  decodeRegistryString,
  formatMac,
  normalizeMac,
} from "./device-naming.js";

const execFileAsync = promisify(execFile);

const REG_BASE =
  "HKLM\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices";

const WINRT_SCRIPT = `
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
`.trim();

async function queryRegistryDeviceNames(): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  try {
    const { stdout } = await execFileAsync("reg", ["query", REG_BASE], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    const deviceKeys = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^HKEY_LOCAL_MACHINE\\/.test(line))
      .map((line) => line.split("\\").pop()!)
      .filter((key) => /^[0-9A-Fa-f]{12}$/.test(key));

    for (const keyName of deviceKeys) {
      for (const valueName of ["LEName", "Name"]) {
        try {
          const { stdout: valueOut } = await execFileAsync(
            "reg",
            ["query", `${REG_BASE}\\${keyName}`, "/v", valueName],
            { encoding: "utf8", timeout: 5_000, windowsHide: true },
          );
          const match = valueOut.match(
            new RegExp(`${valueName}\\s+REG_[A-Z_]+\\s+(.+)`, "i"),
          );
          if (match?.[1]) {
            const decoded = decodeRegistryString(match[1].trim());
            if (decoded) {
              names[normalizeMac(keyName)] = decoded;
              break;
            }
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    // registry unavailable
  }
  return names;
}

export async function loadWindowsPairedNames(): Promise<Record<string, string>> {
  return queryRegistryDeviceNames();
}

async function winrtPairedDevices(): Promise<Array<{ address: string; name: string }>> {
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", WINRT_SCRIPT],
      { encoding: "utf8", timeout: 20_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const raw = stdout.trim();
    if (!raw) {
      return [];
    }
    let data = JSON.parse(raw) as
      | { address: string; name: string }
      | Array<{ address: string; name: string }>;
    if (!Array.isArray(data)) {
      data = [data];
    }
    return data
      .filter((d) => d.name)
      .map((d) => ({ address: formatMac(d.address), name: d.name }));
  } catch {
    return [];
  }
}

export async function loadAllPairedNames(): Promise<Record<string, string>> {
  const merged = await loadWindowsPairedNames();
  for (const item of await winrtPairedDevices()) {
    merged[normalizeMac(item.address)] = item.name;
  }
  return merged;
}

export function lookupPairedName(
  address: string,
  paired: Record<string, string>,
): string | null {
  return paired[normalizeMac(address)] ?? null;
}

export function nameFromPairedValues(
  hint: string | null | undefined,
  paired: Record<string, string>,
): string | null {
  if (!hint) {
    return null;
  }
  const hintL = hint.trim().toLowerCase();
  for (const name of Object.values(paired)) {
    if (name.trim().toLowerCase() === hintL) {
      return name;
    }
  }
  return null;
}
