import { BluetoothClient } from "./bluetooth-client";

const client = new BluetoothClient();
const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "";
const deviceAddress = params.get("address") || "";
const label = params.get("label") || "";

const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const preview = document.getElementById("preview") as HTMLVideoElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const sessionLabel = document.getElementById("sessionLabel") as HTMLElement;

let stream: MediaStream | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d")!;
let frameCount = 0;

sessionLabel.textContent = sessionId || "(missing session — open from HUD QR)";

if (!sessionId) {
  statusEl.textContent = "No session in URL. Open from tactical HUD → SCREEN RELAY → scan QR.";
  startBtn.disabled = true;
}

function setStatus(msg: string, live = false): void {
  statusEl.textContent = msg;
  statusEl.className = live ? "live" : "";
}

async function postFrame(blob: Blob): Promise<void> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const frameJpeg = btoa(binary);
  const data = await client.postScreenFrame({
    sessionId,
    deviceAddress: deviceAddress || undefined,
    label: label || undefined,
    frameJpeg,
    width: canvas.width,
    height: canvas.height,
    ts: Date.now(),
  });
  frameCount = data.frameCount || frameCount + 1;
  setStatus(`LIVE · ${frameCount} frame(s) → monitor HUD`, true);
}

function captureLoop(): void {
  if (!stream || !preview.videoWidth) return;
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  ctx.drawImage(preview, 0, 0);
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await postFrame(blob);
    } catch (e) {
      setStatus("Upload error: " + (e instanceof Error ? e.message : String(e)));
    }
  }, "image/jpeg", 0.72);
}

async function startShare(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("Screen share not supported in this browser. Try Chrome on Android/desktop.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 8 },
      audio: false,
    });
    preview.srcObject = stream;
    preview.style.display = "block";
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Sharing — posting frames to HUD…", true);
    stream.getVideoTracks()[0].onended = () => stopShare();
    timer = setInterval(captureLoop, 200);
    captureLoop();
  } catch (e) {
    setStatus("Share cancelled or denied: " + (e instanceof Error ? e.message : String(e)));
  }
}

function stopShare(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  preview.srcObject = null;
  preview.style.display = "none";
  startBtn.disabled = !sessionId;
  stopBtn.disabled = true;
  setStatus("Stopped.");
}

startBtn.addEventListener("click", () => { startShare().catch(() => {}); });
stopBtn.addEventListener("click", stopShare);
