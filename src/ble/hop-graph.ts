/** Cooperative BLE hop graph — domino-style multi-scanner topology. */

import { formatMac, normalizeMac } from "./device-naming.js";

export type NodeKind = "scanner" | "device";

export const ROOT_NODE_ID = "pc-root";

export interface ScannerNode {
  nodeId: string;
  label: string;
  selfAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  lastSeen: number;
  isRoot: boolean;
}

export interface HopEdge {
  fromId: string;
  toId: string;
  rssi: number | null;
  hop: number;
  seenAt: number;
  viaScanner: string;
}

export class HopGraph {
  scanners: Map<string, ScannerNode> = new Map();
  observations: Map<string, Record<string, unknown>[]> = new Map();
  deviceNames: Map<string, string> = new Map();

  ensureRoot(): void {
    if (!this.scanners.has(ROOT_NODE_ID)) {
      this.scanners.set(ROOT_NODE_ID, {
        nodeId: ROOT_NODE_ID,
        label: "This PC",
        selfAddress: null,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        lastSeen: Date.now() / 1000,
        isRoot: true,
      });
    }
  }

  registerScannerReport(payload: Record<string, unknown>): void {
    const nodeId = String(payload.nodeId ?? "").trim();
    if (!nodeId) {
      throw new Error("nodeId is required");
    }

    const label = String(payload.nodeLabel ?? nodeId).trim();
    let selfAddr = payload.selfAddress as string | undefined;
    if (selfAddr) {
      selfAddr = formatMac(selfAddr);
    }

    const obs = (payload.observations as Record<string, unknown>[]) ?? [];
    const now = Date.now() / 1000;
    let lat = payload.latitude as number | undefined;
    let lon = payload.longitude as number | undefined;
    let acc = payload.accuracyMeters as number | undefined;

    const existing = this.scanners.get(nodeId);
    this.scanners.set(nodeId, {
      nodeId,
      label,
      selfAddress: selfAddr ?? existing?.selfAddress ?? null,
      latitude: lat ?? existing?.latitude ?? null,
      longitude: lon ?? existing?.longitude ?? null,
      accuracyMeters: acc ?? existing?.accuracyMeters ?? null,
      lastSeen: now,
      isRoot: nodeId === ROOT_NODE_ID || (existing?.isRoot ?? false),
    });

    const normalized: Record<string, unknown>[] = [];
    for (const item of obs) {
      const addr = formatMac(String(item.address ?? ""));
      if (!addr || addr.split(":").length !== 6) {
        continue;
      }
      const name = (item.name ?? item.displayName) as string | undefined;
      if (name) {
        this.deviceNames.set(normalizeMac(addr), String(name));
      }
      normalized.push({
        address: addr,
        name,
        rssi: item.rssi,
        seen_at: item.seenAt
          ? Number(item.seenAt) / 1000
          : now,
      });
    }
    this.observations.set(nodeId, normalized);
  }

  ingestPcScan(
    devices: Record<string, unknown>[],
    latitude?: number | null,
    longitude?: number | null,
    accuracyMeters?: number | null,
  ): void {
    const observations: Record<string, unknown>[] = [];
    for (const d of devices) {
      const addr = (d.macAddress ?? d.id) as string | undefined;
      if (!addr) {
        continue;
      }
      observations.push({
        address: formatMac(String(addr)),
        name: d.displayName ?? d.name,
        rssi: d.rssi,
        seenAt: d.lastSeen,
      });
    }
    const report: Record<string, unknown> = {
      nodeId: ROOT_NODE_ID,
      nodeLabel: "This PC",
      observations,
    };
    if (latitude != null && longitude != null) {
      report.latitude = latitude;
      report.longitude = longitude;
      if (accuracyMeters != null) {
        report.accuracyMeters = accuracyMeters;
      }
    }
    this.registerScannerReport(report);
  }

  private macToNodeId(mac: string): string {
    return `dev:${normalizeMac(mac)}`;
  }

  buildGraph(): Record<string, unknown> {
    const scanners = new Map(this.scanners);
    const observations = new Map(
      [...this.observations.entries()].map(([k, v]) => [k, [...v]]),
    );
    const deviceNames = new Map(this.deviceNames);

    const nodes: Record<string, Record<string, unknown>> = {};
    const edges: HopEdge[] = [];

    for (const [sid, scanner] of scanners) {
      nodes[sid] = {
        id: sid,
        kind: "scanner",
        label: scanner.label,
        isRoot: scanner.isRoot,
        selfAddress: scanner.selfAddress,
        latitude: scanner.latitude,
        longitude: scanner.longitude,
        accuracyMeters: scanner.accuracyMeters,
        lastSeen: scanner.lastSeen,
      };
    }

    for (const [sid, obsList] of observations) {
      for (const obs of obsList) {
        const addr = obs.address as string;
        const devId = this.macToNodeId(addr);
        const name =
          (obs.name as string) ??
          deviceNames.get(normalizeMac(addr)) ??
          addr;
        if (!nodes[devId]) {
          nodes[devId] = {
            id: devId,
            kind: "device",
            label: name,
            address: addr,
            isRoot: false,
            lastSeen: obs.seen_at,
          };
        }
        edges.push({
          fromId: sid,
          toId: devId,
          rssi: (obs.rssi as number | null) ?? null,
          hop: 1,
          seenAt: Number(obs.seen_at ?? Date.now() / 1000),
          viaScanner: sid,
        });
      }
    }

    const bridgeEdges: HopEdge[] = [];
    for (const [sid, scanner] of scanners) {
      if (!scanner.selfAddress) {
        continue;
      }
      const devId = this.macToNodeId(scanner.selfAddress);
      if (nodes[devId]) {
        nodes[devId]!.linkedScanner = sid;
        nodes[devId]!.kind = "bridge";
      }
      bridgeEdges.push({
        fromId: devId,
        toId: sid,
        rssi: null,
        hop: 0,
        seenAt: scanner.lastSeen,
        viaScanner: sid,
      });
    }

    const paths: Record<string, string[]> = { [ROOT_NODE_ID]: [ROOT_NODE_ID] };
    const hopDepth: Record<string, number> = { [ROOT_NODE_ID]: 0 };
    const queue: string[] = [ROOT_NODE_ID];

    const adjacency: Record<string, string[]> = {};
    for (const edge of edges) {
      (adjacency[edge.fromId] ??= []).push(edge.toId);
    }
    for (const edge of bridgeEdges) {
      if (nodes[edge.fromId]) {
        (adjacency[edge.fromId] ??= []).push(edge.toId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const target of adjacency[current] ?? []) {
        if (target in hopDepth) {
          continue;
        }
        hopDepth[target] = hopDepth[current]! + 1;
        paths[target] = [...paths[current]!, target];
        queue.push(target);
      }
    }

    const allEdges = [
      ...edges,
      ...bridgeEdges.filter((e) => e.fromId in nodes),
    ];

    for (const [nid, node] of Object.entries(nodes)) {
      node.hopDepth = hopDepth[nid] ?? null;
      node.pathFromRoot = paths[nid] ?? [];
    }

    const chains: Record<string, unknown>[] = [];
    for (const [nid, depth] of Object.entries(hopDepth).sort(
      (a, b) => a[1] - b[1],
    )) {
      if (depth > 0 && nid.startsWith("dev:")) {
        chains.push({
          target: nodes[nid]?.label ?? nid,
          targetId: nid,
          hopDepth: depth,
          path: (paths[nid] ?? []).map((p) => nodes[p]?.label ?? p),
        });
      }
    }

    return {
      rootId: ROOT_NODE_ID,
      scannerCount: scanners.size,
      nodeCount: Object.keys(nodes).length,
      edgeCount: allEdges.length,
      maxHopDepth: Object.keys(hopDepth).length > 0 ? Math.max(...Object.values(hopDepth)) : 0,
      nodes: Object.values(nodes),
      edges: allEdges.map((e) => ({
        from: e.fromId,
        to: e.toId,
        rssi: e.rssi,
        hop: e.hop,
        viaScanner: e.viaScanner,
        seenAt: e.seenAt,
      })),
      chains,
      note:
        "Cooperative hop map: each scanner reports what it hears. " +
        "Domino chains form when a heard device is also a registered hop scanner. " +
        "Passive strangers cannot relay — only your registered nodes extend range.",
    };
  }

  snapshot(): Record<string, unknown> {
    const graph = this.buildGraph();
    const scanners = [...this.scanners.values()]
      .map((s) => ({
        nodeId: s.nodeId,
        label: s.label,
        selfAddress: s.selfAddress,
        latitude: s.latitude,
        longitude: s.longitude,
        accuracyMeters: s.accuracyMeters,
        isRoot: s.isRoot,
        lastSeen: s.lastSeen,
        observationCount: this.observations.get(s.nodeId)?.length ?? 0,
      }))
      .sort((a, b) => {
        if (a.isRoot !== b.isRoot) {
          return a.isRoot ? -1 : 1;
        }
        return a.label.localeCompare(b.label);
      });
    graph.scanners = scanners;
    return graph;
  }
}

export const HOP_GRAPH = new HopGraph();
HOP_GRAPH.ensureRoot();
