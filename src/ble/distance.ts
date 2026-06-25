/** Estimate distance from RSSI using a log-distance path loss model. */

export const DEFAULT_TX_POWER = -59; // dBm at 1 m (typical BLE fallback)
export const PATH_LOSS_EXPONENT = 2.0; // indoor-ish; free space is ~2.0, cluttered home ~2.5-3.5

export type ProximityZone = "immediate" | "near" | "far" | "unknown";

export const METERS_TO_FEET = 3.28084;
export const METERS_TO_MILES = 1 / 1609.344;

export function estimateDistanceMeters(
  rssi: number | null | undefined,
  txPower?: number | null,
  pathLossExponent: number = PATH_LOSS_EXPONENT,
): number | null {
  if (rssi == null) {
    return null;
  }
  const measuredTx = txPower ?? DEFAULT_TX_POWER;
  try {
    const exponent = (measuredTx - rssi) / (10.0 * pathLossExponent);
    const distance = 10.0 ** exponent;
    if (!Number.isFinite(distance) || distance < 0) {
      return null;
    }
    return Math.max(0.1, Math.min(distance, 500.0));
  } catch {
    return null;
  }
}

export function proximityZone(distanceMeters: number | null | undefined): ProximityZone {
  if (distanceMeters == null) {
    return "unknown";
  }
  if (distanceMeters <= 3.0) {
    return "immediate";
  }
  if (distanceMeters <= 15.0) {
    return "near";
  }
  return "far";
}

export function formatDistance(distanceMeters: number | null | undefined): string {
  if (distanceMeters == null) {
    return "Unknown";
  }
  const feet = distanceMeters * METERS_TO_FEET;
  if (feet < 528) {
    return `${feet.toFixed(0)} ft`;
  }
  const miles = distanceMeters * METERS_TO_MILES;
  if (miles < 0.1) {
    return `${feet.toFixed(0)} ft`;
  }
  return `${miles.toFixed(2)} mi`;
}

export function distancePayload(
  rssi: number | null | undefined,
  txPower?: number | null,
): Record<string, unknown> {
  const meters = estimateDistanceMeters(rssi, txPower);
  const feet = meters != null ? meters * METERS_TO_FEET : null;
  const miles = meters != null ? meters * METERS_TO_MILES : null;
  const zone = proximityZone(meters);
  return {
    distanceMeters: meters != null ? Math.round(meters * 100) / 100 : null,
    distanceFeet: feet != null ? Math.round(feet * 10) / 10 : null,
    distanceMiles: miles != null ? Math.round(miles * 10000) / 10000 : null,
    distanceLabel: formatDistance(meters),
    proximityZone: zone,
    rssi,
    txPower,
    distanceNote: "Estimated from RSSI - walls and interference affect accuracy.",
  };
}
