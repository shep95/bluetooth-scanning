#!/usr/bin/env node
/** Companion hop scanner — reports observations to root mapper. */

import { parseArgs } from "node:util";
import { formatMac } from "../ble/device-naming.js";
import { scanOnce } from "../server/scanner.js";

async function postReport(
  server: string,
  nodeId: string,
  label: string,
  selfAddress: string | null,
  observations: Record<string, unknown>[],
  listeningPost = false,
  latitude?: number,
  longitude?: number,
  accuracyMeters?: number,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    nodeId,
    nodeLabel: label,
    selfAddress,
    observations,
    listeningPost,
  };
  if (latitude != null && longitude != null) {
    payload.latitude = latitude;
    payload.longitude = longitude;
    if (accuracyMeters != null) payload.accuracyMeters = accuracyMeters;
  }
  const res = await fetch(`${server.replace(/\/$/, "")}/api/hop/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function runLoop(opts: {
  server: string;
  nodeId: string;
  label: string;
  selfAddress: string | null;
  duration: number;
  interval: number;
  listeningPost: boolean;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}): Promise<void> {
  const tag = opts.listeningPost ? "LISTENING POST" : "hop node";
  console.log(
    `Continuous ${tag} '${opts.label}' → ${opts.server} (scan ${opts.duration}s, repeat every ${opts.interval}s)`,
  );
  while (true) {
    const observations = await scanOnce(opts.duration);
    try {
      const result = await postReport(
        opts.server,
        opts.nodeId,
        opts.label,
        opts.selfAddress,
        observations,
        opts.listeningPost,
        opts.latitude,
        opts.longitude,
        opts.accuracyMeters,
      );
      const depth = ((result.hopGraph as Record<string, unknown>)?.maxHopDepth as number) ?? 0;
      console.log(
        `[${new Date().toLocaleTimeString()}] reported ${observations.length} contact(s) · graph depth ${depth}`,
      );
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] server unreachable:`, e);
    }
    await new Promise((r) => setTimeout(r, opts.interval * 1000));
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:8765" },
      "node-id": { type: "string" },
      label: { type: "string" },
      "self-address": { type: "string" },
      duration: { type: "string", default: "12" },
      interval: { type: "string", default: "15" },
      loop: { type: "boolean", default: false },
      "listening-post": { type: "boolean", default: false },
      latitude: { type: "string" },
      longitude: { type: "string" },
      "accuracy-meters": { type: "string" },
    },
  });

  const nodeId = values["node-id"];
  if (!nodeId) {
    console.error("--node-id is required");
    return 1;
  }
  const label = values.label ?? nodeId;
  const selfAddress = values["self-address"] ? formatMac(values["self-address"]) : null;
  const duration = Number(values.duration);
  const interval = Number(values.interval);
  const lat = values.latitude != null ? Number(values.latitude) : undefined;
  const lon = values.longitude != null ? Number(values.longitude) : undefined;
  const acc = values["accuracy-meters"] != null ? Number(values["accuracy-meters"]) : undefined;

  if (values.loop) {
    await runLoop({
      server: values.server!,
      nodeId,
      label,
      selfAddress,
      duration,
      interval,
      listeningPost: values["listening-post"] ?? false,
      latitude: lat,
      longitude: lon,
      accuracyMeters: acc,
    });
    return 0;
  }

  console.log(`Scanning ${duration}s as hop node '${label}'...`);
  const observations = await scanOnce(duration);
  console.log(`Seen ${observations.length} device(s), posting to ${values.server}...`);
  try {
    const result = await postReport(
      values.server!,
      nodeId,
      label,
      selfAddress,
      observations,
      values["listening-post"] ?? false,
      lat,
      lon,
      acc,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    console.error("Failed to reach server:", e);
    return 1;
  }
}

main().then((code) => process.exit(code));
