/** Merge hop scanner observations into the root mapper's unified device list. */

import { formatMac, normalizeMac } from "./device-naming.js";

function bestObservationForDevice(
  devId: string,
  hopGraph: Record<string, unknown>,
): [Record<string, unknown> | null, string | null, number | null] {
  const nodes = Object.fromEntries(
    ((hopGraph.nodes as Record<string, unknown>[]) ?? []).map((n) => [n.id, n]),
  );
  let bestRssi: number | null = null;
  let via: string | null = null;
  for (const edge of (hopGraph.edges as Record<string, unknown>[]) ?? []) {
    if (edge.to !== devId || edge.hop !== 1) {
      continue;
    }
    const rssi = edge.rssi as number | null | undefined;
    if (rssi == null) {
      via = (edge.viaScanner as string) ?? (edge.from as string) ?? null;
      continue;
    }
    if (bestRssi == null || rssi > bestRssi) {
      bestRssi = rssi;
      via = (edge.viaScanner as string) ?? (edge.from as string) ?? null;
    }
  }
  const scanner = via ? (nodes[via] as Record<string, unknown> | undefined) ?? {} : null;
  return [via ? scanner : null, via, bestRssi];
}

export function mergeHopRelayDevices(
  deviceList: Record<string, unknown>[],
  hopGraph: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!hopGraph || Object.keys(hopGraph).length === 0) {
    return deviceList;
  }

  const existing = new Set(
    deviceList.map((d) =>
      normalizeMac(String(d.macAddress ?? d.id ?? "")),
    ),
  );
  const scanners = Object.fromEntries(
    ((hopGraph.scanners as Record<string, unknown>[]) ?? []).map((s) => [s.nodeId, s]),
  );
  const merged = [...deviceList];

  for (const node of (hopGraph.nodes as Record<string, unknown>[]) ?? []) {
    if (node.kind !== "device" && node.kind !== "bridge") {
      continue;
    }
    const addr = node.address as string | undefined;
    if (!addr) {
      continue;
    }
    const nmac = normalizeMac(addr);
    if (!nmac || existing.has(nmac)) {
      continue;
    }

    const [scannerMeta, viaId, rssi] = bestObservationForDevice(
      node.id as string,
      hopGraph,
    );
    const scannerLabel =
      (scannerMeta?.label as string) ?? viaId ?? "hop node";
    const hopDepth = node.hopDepth as number | undefined;
    const pathIds = (node.pathFromRoot as string[]) ?? [];
    const nodesById = Object.fromEntries(
      ((hopGraph.nodes as Record<string, unknown>[]) ?? []).map((n) => [n.id, n]),
    );
    const pathLabels = pathIds.map(
      (p) => (nodesById[p]?.label as string) ?? p,
    );

    merged.push({
      id: formatMac(addr),
      macAddress: formatMac(addr),
      displayName: (node.label as string) ?? formatMac(addr),
      name: (node.label as string) ?? formatMac(addr),
      nameSource: "hop_relay",
      rssi,
      rssiHuman:
        rssi == null ? "Relayed via hop scanner — not heard by root radio" : null,
      hopDepth,
      hopPath: pathLabels,
      reportedByScanner: scannerLabel,
      reportedByScannerId: viaId,
      hopRelayOnly: true,
      exfilTier: "PASSIVE_ONLY",
      pullStatus: "hop_relay",
      distanceLabel: "Via hop relay",
      proximityZone: "unknown",
      threatTier:
        hopDepth != null && hopDepth >= 3 ? "breach" : "unknown",
      location: {
        coLocated: false,
        contextNote: `Heard by hop scanner '${scannerLabel}' and merged into root map — not directly observed by this PC radio.`,
      },
      passiveIntel: {
        narrative: "Hop relay observation",
        flaw: "No live adv packets on root scanner",
        fix: "Cooperative hop_reporter POST /api/hop/report",
        connectableGuess: "unknown",
      },
      lastSeen: node.lastSeen
        ? Math.trunc(Number(node.lastSeen) * 1000)
        : null,
    });
    existing.add(nmac);
  }

  for (const d of merged) {
    const nmac = normalizeMac(String(d.macAddress ?? d.id ?? ""));
    const reporters: string[] = [];
    const devId = `dev:${nmac}`;
    for (const edge of (hopGraph.edges as Record<string, unknown>[]) ?? []) {
      if (edge.to === devId && edge.hop === 1) {
        const sid = (edge.viaScanner as string) ?? (edge.from as string);
        if (sid && sid !== "pc-root") {
          const label =
            (scanners[sid]?.label as string) ?? sid;
          if (!reporters.includes(label)) {
            reporters.push(label);
          }
        }
      }
    }
    if (reporters.length > 0) {
      d.alsoReportedBy = reporters;
    }
  }

  merged.sort((a, b) => {
    const aDepth = a.hopDepth != null ? Number(a.hopDepth) : 999;
    const bDepth = b.hopDepth != null ? Number(b.hopDepth) : 999;
    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }
    const aRssi = a.rssi != null ? Number(a.rssi) : -999;
    const bRssi = b.rssi != null ? Number(b.rssi) : -999;
    return bRssi - aRssi;
  });

  return merged;
}

export function hopRelaySummary(
  hopGraph: Record<string, unknown>,
  deviceList: Record<string, unknown>[],
): Record<string, unknown> {
  const relayOnly = deviceList.filter((d) => d.hopRelayOnly).length;
  const scanners = (hopGraph.scanners as Record<string, unknown>[]) ?? [];
  const reporting = scanners.filter(
    (s) => Number(s.observationCount ?? 0) > 0,
  );
  return {
    rootMapper: "This PC",
    reportingScanners: reporting.length,
    totalScanners: scanners.length,
    relayOnlyContacts: relayOnly,
    directContacts: deviceList.length - relayOnly,
    note: "Each cooperative scanner POSTs every device it hears; root merges all into one map.",
  };
}
