/** In-memory screen frame relay store — consent-based JPEG ingest from companion browsers. */

import { randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

export const MAX_FRAME_BYTES = 2_500_000;
export const MAX_SESSIONS = 12;
export const SESSION_TTL_SEC = 300.0;
export const FRAME_STALE_SEC = 30.0;

/** Best-effort LAN address for QR / relay URLs. */
export function lanIp(): string {
  try {
    const s = dgram.createSocket("udp4");
    s.connect(80, "8.8.8.8");
    const ip = s.address().address;
    s.close();
    if (ip && ip !== "0.0.0.0") {
      return ip;
    }
  } catch {
    // fall through
  }

  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export class FrameSession {
  sessionId: string;
  deviceAddress: string | null = null;
  label: string = "Relay";
  createdAt: number;
  lastFrameAt: number | null = null;
  frameCount: number = 0;
  lastWidth: number | null = null;
  lastHeight: number | null = null;
  lastFrame: Buffer | null = null;
  streaming: boolean = false;

  constructor(sessionId: string, deviceAddress?: string | null, label?: string) {
    this.sessionId = sessionId;
    this.deviceAddress = deviceAddress ?? null;
    if (label) {
      this.label = label;
    }
    this.createdAt = Date.now() / 1000;
  }

  toDict(): Record<string, unknown> {
    const now = Date.now() / 1000;
    return {
      sessionId: this.sessionId,
      deviceAddress: this.deviceAddress,
      label: this.label,
      createdAt: this.createdAt,
      lastFrameAt: this.lastFrameAt,
      frameCount: this.frameCount,
      width: this.lastWidth,
      height: this.lastHeight,
      streaming: this.streaming,
      live: Boolean(
        this.lastFrameAt && now - this.lastFrameAt < FRAME_STALE_SEC,
      ),
      ageSec: Math.round((now - this.createdAt) * 10) / 10,
    };
  }
}

export class FrameStore {
  sessions: Map<string, FrameSession> = new Map();

  private prune(): void {
    const now = Date.now() / 1000;
    for (const [sid, s] of this.sessions) {
      if (
        now - s.createdAt > SESSION_TTL_SEC &&
        (!s.lastFrameAt || now - s.lastFrameAt > SESSION_TTL_SEC)
      ) {
        this.sessions.delete(sid);
      }
    }
    if (this.sessions.size > MAX_SESSIONS) {
      const ordered = [...this.sessions.values()].sort(
        (a, b) => (a.lastFrameAt ?? a.createdAt) - (b.lastFrameAt ?? b.createdAt),
      );
      const excess = ordered.length - MAX_SESSIONS;
      for (let i = 0; i < excess; i++) {
        this.sessions.delete(ordered[i]!.sessionId);
      }
    }
  }

  createSession(
    deviceAddress?: string | null,
    label?: string | null,
  ): FrameSession {
    const sid = randomBytes(12).toString("base64url");
    const session = new FrameSession(
      sid,
      deviceAddress,
      label ?? "Screen relay",
    );
    this.prune();
    this.sessions.set(sid, session);
    return session;
  }

  get(sessionId: string): FrameSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  ingestFrame(
    sessionId: string,
    jpeg: Buffer,
    width?: number | null,
    height?: number | null,
    deviceAddress?: string | null,
  ): Record<string, unknown> {
    if (jpeg.length > MAX_FRAME_BYTES) {
      return { ok: false, error: "frame too large" };
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "unknown session" };
    }
    session.lastFrame = jpeg;
    session.lastFrameAt = Date.now() / 1000;
    session.frameCount += 1;
    session.streaming = true;
    if (width) {
      session.lastWidth = width;
    }
    if (height) {
      session.lastHeight = height;
    }
    if (deviceAddress) {
      session.deviceAddress = deviceAddress;
    }
    return { ok: true, frameCount: session.frameCount, sessionId };
  }

  latestJpeg(sessionId: string): [Buffer | null, FrameSession | null] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [null, null];
    }
    return [session.lastFrame, session];
  }

  snapshot(): Record<string, unknown> {
    this.prune();
    const sessions = [...this.sessions.values()].map((s) => s.toDict());
    const live = sessions.filter((s) => s.live).length;
    return {
      sessionCount: sessions.length,
      liveCount: live,
      sessions: sessions.sort(
        (a, b) => Number(b.lastFrameAt ?? 0) - Number(a.lastFrameAt ?? 0),
      ),
    };
  }
}

export const FRAME_STORE = new FrameStore();

export function relayUrls(
  sessionId: string,
  port: number,
  bindAll: boolean,
): Record<string, string> {
  const host = bindAll ? lanIp() : "127.0.0.1";
  const base = `http://${host}:${port}`;
  return {
    relayPage: `${base}/relay?session=${sessionId}`,
    latestFrame: `${base}/api/screen/frame/latest?session=${sessionId}`,
    ingest: `${base}/api/screen/frame`,
  };
}
