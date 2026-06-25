/** Scanner geolocation + reverse geocode for co-location context. */

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
export const USER_AGENT = "bluetooth-scanning/1.0 (local testing tool)";

/** Devices within this radius are tagged as co-located with the scanner (same home/room). */
export const CO_LOCATE_RADIUS_METERS = 15.0;

export class ScannerLocation {
  latitude: number | null = null;
  longitude: number | null = null;
  accuracyMeters: number | null = null;
  address: string | null = null;
  addressShort: string | null = null;
  source: string | null = null;
  updatedAt: number | null = null;

  setCoords(
    latitude: number,
    longitude: number,
    accuracyMeters?: number | null,
    source: string = "browser",
  ): void {
    this.latitude = latitude;
    this.longitude = longitude;
    this.accuracyMeters = accuracyMeters ?? null;
    this.source = source;
    this.address = null;
    this.addressShort = null;
    this.updatedAt = Date.now() / 1000;
  }

  setAddress(full: string, short?: string | null): void {
    this.address = full;
    this.addressShort = short ?? full;
    this.updatedAt = Date.now() / 1000;
  }

  snapshot(): Record<string, unknown> {
    return {
      latitude: this.latitude,
      longitude: this.longitude,
      accuracyMeters: this.accuracyMeters,
      address: this.address,
      addressShort: this.addressShort,
      source: this.source,
      updatedAt: this.updatedAt,
      ready: this.latitude != null && this.longitude != null,
    };
  }
}

export const SCANNER_LOCATION = new ScannerLocation();

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<[string, string]> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "jsonv2",
    addressdetails: "1",
  });
  const resp = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await resp.json()) as {
    display_name?: string;
    address?: Record<string, string | undefined>;
  };

  const address = data.display_name ?? "Unknown location";
  const parts = data.address ?? {};
  const shortParts = [
    parts.house_number,
    parts.road,
    parts.city ?? parts.town ?? parts.village,
    parts.state,
  ].filter(Boolean);
  const short = shortParts.length > 0 ? shortParts.join(", ") : address;
  return [address, short];
}

export function locationContextForDevice(
  distanceMeters: number | null | undefined,
  scanner: ScannerLocation,
): Record<string, unknown> {
  const snap = scanner.snapshot();
  const coLocated =
    distanceMeters != null &&
    distanceMeters <= CO_LOCATE_RADIUS_METERS &&
    snap.ready === true;

  return {
    coLocated,
    estimatedAddress: coLocated ? snap.address : null,
    estimatedAddressShort: coLocated ? snap.addressShort : null,
    scannerLatitude: snap.latitude,
    scannerLongitude: snap.longitude,
    contextNote: coLocated
      ? "Device was in range while your PC was at this address (estimated co-location)."
      : "BLE cannot report a remote device's home address — only your scanner location is known.",
  };
}
