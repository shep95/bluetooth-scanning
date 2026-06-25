// @ts-nocheck — migrated HUD script; API calls use BluetoothClient
import {
  BluetoothClient,
  type ScanSnapshot,
  type ScannedDevice,
  type TheoriesSnapshot,
  type ScreenRelaySnapshot,
  type ScenarioId,
} from "./bluetooth-client";

const client = new BluetoothClient();

let pollTimer = null;
    let lastCount = 0;
    let audioCtx = null;
    let scene, camera, renderer, nodeMeshes = {};
    let tacticalMap = null;
    const mapLayers = { markers: [], circles: [], lines: [] };

    const healthEl = document.getElementById("health");
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("list");
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const locBtn = document.getElementById("locBtn");
    const locEl = document.getElementById("location");
    const scenarioEl = document.getElementById("scenario");
    const missionPhaseEl = document.getElementById("missionPhase");
    const tickerEl = document.getElementById("ticker");
    const interferenceEl = document.getElementById("interference");
    const chronoEl = document.getElementById("chrono");
    const alertsEl = document.getElementById("alerts");
    const relayEl = document.getElementById("relayScores");
    const hopStats = document.getElementById("hopStats");
    const breachChains = document.getElementById("breachChains");
    const toast = document.getElementById("toast");
    const audioToggle = document.getElementById("audioToggle");
    const extractBtn = document.getElementById("extractBtn");
    const briefBtn = document.getElementById("briefBtn");
    const voiceBtn = document.getElementById("voiceBtn");
    const redBlueToggle = document.getElementById("redBlueToggle");
    const sciFiPanel = document.getElementById("sciFiPanel");
    const poseSensePanel = document.getElementById("poseSensePanel");
    const poseFusionSteps = document.getElementById("poseFusionSteps");
    const screenRelayPanel = document.getElementById("screenRelayPanel");
    const screenRelaySteps = document.getElementById("screenRelaySteps");
    const relayViewerWrap = document.getElementById("relayViewerWrap");
    const relayViewer = document.getElementById("relayViewer");
    const relayQr = document.getElementById("relayQr");
    const relaySessionMeta = document.getElementById("relaySessionMeta");
    let relayPollTimer = null;
    let activeRelaySession = null;
    const threatBoard = document.getElementById("threatBoard");
    const replaySlider = document.getElementById("replaySlider");
    const replayPanel = document.getElementById("replayPanel");
    const theoriesPanel = document.getElementById("theoriesPanel");
    const securitySummaryEl = document.getElementById("securitySummary");
    const theoryFilterEl = document.getElementById("theoryFilter");
    const sseStatus = document.getElementById("sseStatus");
    let theoryCache: TheoriesSnapshot | null = null;
    let threatRotate = 0;

    const TIER_LABELS = { friendly: "ALLY", known: "KNOWN", unknown: "UNKNOWN", priority: "TARGET LOCK", breach: "DEEP BREACH" };
    const TREND_LABELS = { approaching: "↗ APPROACHING", receding: "↘ RECEDING", static: "● HOLDING", unknown: "?" };
    const EXFIL_LABELS = {
      OPEN: "GATT OPEN", PARTIAL: "GATT PARTIAL", LOCKED: "GATT LOCKED",
      PASSIVE_ONLY: "PASSIVE ONLY", UNKNOWN: "UNKNOWN",
    };

    function exfilTierClass(tier) {
      const map = { OPEN: "open", PARTIAL: "partial", LOCKED: "locked", PASSIVE_ONLY: "passive", UNKNOWN: "unknown" };
      return map[tier] || "unknown";
    }

    function exfilTierBadge(tier) {
      const t = tier || "UNKNOWN";
      return `<span class="exfil-tier ${exfilTierClass(t)}">${escapeHtml(EXFIL_LABELS[t] || t)}</span>`;
    }

    function renderScreenRelayForDevice(d) {
      if (!d) return "";
      return `<div class="intel-block"><h4>Screen relay</h4>
        <div class="intel-row">BLE cannot show pixels — tap <strong>SCREEN RELAY</strong> for QR + live monitor feed.</div></div>`;
    }

    async function startRelaySession(address: string, displayName: string) { try { const data = await client.createScreenSession({ deviceAddress: address, label: displayName || address });
      activeRelaySession = data.session?.sessionId || null;
      const relayPage = data.urls?.relayPage || "";
      relayViewerWrap.style.display = "block";
      relayQr.src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data="
        + encodeURIComponent(relayPage);
      relaySessionMeta.innerHTML =
        `<strong>Session</strong> <code>${escapeHtml(activeRelaySession)}</code><br>` +
        `<a href="${escapeHtml(relayPage)}" target="_blank" rel="noopener" style="color:var(--cyan)">${escapeHtml(relayPage)}</a><br>` +
        `<span class="meta">${escapeHtml(data.phoneNote || "")}</span>`;
      screenRelayPanel.innerHTML =
        `<strong>Live relay armed</strong> — scan QR on phone or open link → START SHARE<br>` +
        `<span class="meta">Device: ${escapeHtml(displayName || address)}</span>`;
      if (relayPollTimer) clearInterval(relayPollTimer);
      relayPollTimer = setInterval(() => {
        if (!activeRelaySession) return;
        const img = new Image();
        img.onload = () => { relayViewer.src = img.src; };
        img.onerror = () => { /* waiting for first frame */ };
        img.src = client.latestScreenFrameUrl(activeRelaySession);
      }, 300);
      await loadScreenRelay(address); showToast("Scan QR on device → START SHARE"); } catch (e) { showToast(e instanceof Error ? e.message : "Session failed"); return; } }

    function renderScreenRelayPanel(relay: ScreenRelaySnapshot) {
      if (!relay || !relay.recommendation) return;
      const rec = relay.recommendation;
      screenRelayPanel.innerHTML =
        `<strong>${escapeHtml(rec.narrative || "Screen relay")}</strong><br>
        <span class="meta">${escapeHtml(relay.honestLimit || "")}</span><br>
        Platform guess: <code>${escapeHtml(rec.guessedPlatform || "?")}</code> ·
        GATT tier: <code>${escapeHtml(rec.gattExfilTier || "?")}</code><br>
        <strong>Recommended:</strong> ${escapeHtml(rec.recommendedTheoryId || "?")} — ${escapeHtml(rec.recommendedFix || "")}<br>
        <code class="theory-code">${escapeHtml(rec.recommendedCode || "")}</code>`;
      const steps = rec.operatorSteps || [];
      screenRelaySteps.innerHTML = steps.length
        ? "<strong>Operator steps</strong><br>" + steps.map((s) => `· ${escapeHtml(s)}`).join("<br>")
        : "";
    }

    async function loadPoseSense() { try { const data = await client.getWifiPose();
        const story = data.story || {};
        const cmu = data.cmuResearch || {};
        poseSensePanel.innerHTML =
          `<strong>PoseSense</strong> — ${escapeHtml(story.protagonist || "Wayne")} + ${escapeHtml(story.subject || "Dr. Emily")}<br>` +
          `<span class="meta">${escapeHtml(story.scene || "")}</span><br>` +
          `<strong>CMU research:</strong> ${escapeHtml(cmu.summary || "")}<br>` +
          `<span class="meta">${escapeHtml(data.honestLimit || "")}</span>`;
        const steps = (data.fusion || {}).fusionSteps || [];
        poseFusionSteps.innerHTML = steps.length
          ? "<strong>Fusion chain</strong><br>" + steps.map((s) => `· ${escapeHtml(s)}`).join("<br>")
          : "";
      } catch (_) {}
    }

    async function loadScreenRelay(address?: string) { try { renderScreenRelayPanel(await client.getScreenRelay(address));
      } catch (_) { /* server starting or old build */ }
    }

    function renderPassiveIntel(pi) {
      if (!pi) return "";
      const beacons = (pi.beacons || []).map((b) =>
        `<div class="intel-row"><strong>${escapeHtml(b.label || b.type)}</strong> ${escapeHtml(b.uuid || b.raw || "")}</div>`
      ).join("");
      const hints = (pi.ecosystemHints || []).map((h) =>
        `<span class="sci-tag">${escapeHtml(h)}</span>`
      ).join("");
      const mfg = (pi.manufacturerRecords || []).map((m) =>
        `<div class="intel-row"><strong>${escapeHtml(m.companyName)}</strong> <code>${escapeHtml(m.hex || "")}</code></div>`
      ).join("");
      const svcs = (pi.serviceLabels || []).slice(0, 8).map((s) =>
        `<span class="sci-tag">${escapeHtml(s)}</span>`
      ).join("");
      return `<div class="intel-block">
        <h4>Passive advertisement intel</h4>
        ${pi.broadcastName ? `<div class="intel-row"><strong>Adv name:</strong> ${escapeHtml(pi.broadcastName)}</div>` : ""}
        ${pi.connectableGuess ? `<div class="intel-row"><strong>Connectable:</strong> ${escapeHtml(pi.connectableGuess)}</div>` : ""}
        ${pi.txPower != null ? `<div class="intel-row"><strong>TX power:</strong> ${pi.txPower} dBm</div>` : ""}
        ${hints ? `<div class="intel-row">${hints}</div>` : ""}
        ${beacons || "<div class='intel-row'>No beacon frames decoded</div>"}
        ${mfg || ""}
        ${svcs ? `<div class="intel-row" style="margin-top:0.25rem">${svcs}</div>` : ""}
      </div>`;
    }

    function renderGattFields(d) {
      const pulled = d.pulledData;
      const data = pulled?.data || {};
      const labels = d.charLabels || {};
      const keys = Object.keys(data).filter((k) => data[k] != null && data[k] !== "");
      if (!keys.length && d.pullStatus === "pending") {
        return `<div class="intel-block"><h4>GATT exfil</h4><div class="intel-row">Queued for background pull…</div></div>`;
      }
      if (!keys.length) {
        const errs = (pulled?.errors || []).slice(0, 3).map(escapeHtml).join("; ");
        return `<div class="intel-block"><h4>GATT exfil</h4><div class="intel-row">${errs || "No readable characteristics — device may block unknown PCs."}</div></div>`;
      }
      const rows = keys.map((k) => {
        const label = labels[k] || k;
        return `<div class="intel-row"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(data[k])}</div>`;
      }).join("");
      const summary = (d.intelSummary || []).map((line) =>
        `<div class="intel-row">${escapeHtml(line)}</div>`
      ).join("");
      return `<div class="intel-block">
        <h4>GATT exfil · ${escapeHtml(pulled?.exfilTier || d.exfilTier || "?")}</h4>
        ${summary || rows}
        ${summary ? `<div style="margin-top:0.35rem">${rows}</div>` : ""}
      </div>`;
    }

    function renderGattAtlas(atlas) {
      if (!atlas || !atlas.length) return "";
      const svcs = atlas.slice(0, 12).map((svc) => {
        const chars = (svc.characteristics || []).slice(0, 8).map((c) => {
          const val = c.valueText || c.valueHex || c.readError || (c.properties || []).join(",");
          return `<div class="intel-row" style="padding-left:0.5rem">· ${escapeHtml(c.key || c.uuid)} — ${escapeHtml(String(val).slice(0, 64))}</div>`;
        }).join("");
        return `<div class="atlas-svc"><strong>${escapeHtml(svc.key || svc.uuid)}</strong>${chars}</div>`;
      }).join("");
      const more = atlas.length > 12 ? `<div class="intel-row">+ ${atlas.length - 12} more services</div>` : "";
      return `<div class="intel-block"><h4>GATT atlas (${atlas.length} services)</h4>${svcs}${more}</div>`;
    }

    function renderDeviceIntel(d) {
      return renderPassiveIntel(d.passiveIntel) + renderGattFields(d) + renderGattAtlas(d.gattAtlas) +
        renderDeviceTheories(d.theories) + renderScreenRelayForDevice(d);
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function playBlip(freq = 440, dur = 0.08) {
      if (!audioToggle.checked) return;
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = freq;
        g.gain.value = 0.06;
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + dur);
      } catch (_) {}
    }

    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 4000);
      playBlip(880, 0.15);
    }

    function hashBearing(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
      return Math.abs(h) % 360;
    }

    function offsetLatLon(lat, lon, meters, bearingDeg) {
      const R = 6378137;
      const br = bearingDeg * Math.PI / 180;
      const d = meters / R;
      const lat1 = lat * Math.PI / 180;
      const lon1 = lon * Math.PI / 180;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
      const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
    }

    function clearMapLayers() {
      mapLayers.markers.forEach((l) => tacticalMap.removeLayer(l));
      mapLayers.circles.forEach((l) => tacticalMap.removeLayer(l));
      mapLayers.lines.forEach((l) => tacticalMap.removeLayer(l));
      mapLayers.markers = [];
      mapLayers.circles = [];
      mapLayers.lines = [];
    }

    function initTacticalMap(lat, lon) {
      if (!tacticalMap) return;
      if (!tacticalMap._hasGps) {
        tacticalMap.setView([lat, lon], 17);
        tacticalMap._hasGps = true;
      } else if (!tacticalMap._userPanned) {
        tacticalMap.setView([lat, lon], Math.max(tacticalMap.getZoom(), 16));
      }
    }

    function updateTacticalMap(data) {
      const mapNote = document.getElementById("mapNote");
      const loc = data.scannerLocation;
      if (!loc?.ready) {
        mapNote.textContent = "Share scanner GPS to enable map — BLE devices have no GPS of their own.";
        return;
      }
      const lat = loc.latitude;
      const lon = loc.longitude;
      initTacticalMap(lat, lon);
      clearMapLayers();
      mapNote.textContent = loc.addressShort
        ? `Scanner @ ${loc.addressShort} · rings = RSSI estimate · not device street address`
        : "Scanner GPS active · device positions are illustrative bearing from RSSI distance";

      const root = L.circleMarker([lat, lon], {
        radius: 10, color: "#39ff14", fillColor: "#39ff14", fillOpacity: 0.95, weight: 2,
      });
      root.bindPopup(`<strong>Root scanner</strong><br>${escapeHtml(loc.addressShort || "This PC")}`);
      root.addTo(tacticalMap);
      mapLayers.markers.push(root);

      if (loc.accuracyMeters) {
        const acc = L.circle([lat, lon], {
          radius: loc.accuracyMeters, color: "#39ff14", fillOpacity: 0.04, weight: 1, dashArray: "4",
        });
        acc.addTo(tacticalMap);
        mapLayers.circles.push(acc);
      }

      const geofence = L.circle([lat, lon], {
        radius: 15, color: "#00e5ff", fillOpacity: 0.03, weight: 1, dashArray: "6 4",
      });
      geofence.bindPopup("15 m co-location perimeter (your scanner zone)");
      geofence.addTo(tacticalMap);
      mapLayers.circles.push(geofence);

      (data.hopGraph?.scanners || []).forEach((s) => {
        if (s.isRoot || s.latitude == null || s.longitude == null) return;
        const m = L.circleMarker([s.latitude, s.longitude], {
          radius: 8, color: "#00e5ff", fillColor: "#00e5ff", fillOpacity: 0.85, weight: 2,
        });
        m.bindPopup(`<strong>${escapeHtml(s.label)}</strong><br>Hop / listening post`);
        m.addTo(tacticalMap);
        mapLayers.markers.push(m);
        const line = L.polyline([[lat, lon], [s.latitude, s.longitude]], {
          color: "#00e5ff", weight: 2, opacity: 0.55, dashArray: "8 6",
        });
        line.addTo(tacticalMap);
        mapLayers.lines.push(line);
      });

      const colors = {
        friendly: "#39ff14", known: "#00e5ff", unknown: "#ffb020",
        priority: "#ff3355", breach: "#ff6699",
      };
      (data.devices || []).forEach((d) => {
        const dist = Math.max(3, d.distanceMeters || 8);
        const bearing = hashBearing(String(d.id || d.macAddress || "x"));
        const pos = offsetLatLon(lat, lon, dist, bearing);
        const col = colors[d.threatTier] || "#888";
        const ring = L.circle(pos, {
          radius: dist, color: col, fillOpacity: 0.07, weight: 1, opacity: 0.7,
        });
        ring.bindPopup(
          `<strong>${escapeHtml(d.displayName || d.id)}</strong><br>` +
          `~${escapeHtml(d.distanceLabel || "?")} · RSSI ${d.rssi ?? "?"} dBm<br>` +
          `<em>Direction illustrative — BLE has no compass bearing.</em>`
        );
        ring.addTo(tacticalMap);
        mapLayers.circles.push(ring);
        const dot = L.circleMarker(pos, {
          radius: 5, color: col, fillColor: col, fillOpacity: 0.9, weight: 1,
        });
        dot.addTo(tacticalMap);
        mapLayers.markers.push(dot);
      });

      if (!tacticalMap._userPanned && tacticalMap._hasGps) {
        tacticalMap.setView([lat, lon], Math.max(tacticalMap.getZoom(), 16));
      }
      setTimeout(() => tacticalMap.invalidateSize(), 80);
    }

    function initBattlefield() {
      const el = document.getElementById("battlefield");
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 100);
      camera.position.set(0, 8, 12);
      camera.lookAt(0, 0, 0);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.setClearColor(0x050810);
      el.appendChild(renderer.domElement);
      const light = new THREE.DirectionalLight(0x00e5ff, 0.8);
      light.position.set(5, 10, 5);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0x223344, 0.6));
      const rootGeo = new THREE.SphereGeometry(0.5, 16, 16);
      const rootMat = new THREE.MeshBasicMaterial({ color: 0x39ff14 });
      const root = new THREE.Mesh(rootGeo, rootMat);
      root.position.set(0, 0, 0);
      scene.add(root);
      nodeMeshes["pc-root"] = root;
      function animate() {
        requestAnimationFrame(animate);
        Object.values(nodeMeshes).forEach((m, i) => { if (i > 0) m.rotation.y += 0.01; });
        renderer.render(scene, camera);
      }
      animate();
    }

    function updateBattlefield(hop) {
      if (!scene || !hop) return;
      const nodes = hop.nodes || [];
      const n = nodes.length || 1;
      nodes.forEach((node, i) => {
        const id = node.id;
        if (id === "pc-root") return;
        const angle = (i / n) * Math.PI * 2;
        const r = 3 + (node.hopDepth || 1) * 1.2;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (!nodeMeshes[id]) {
          const geo = new THREE.SphereGeometry(0.35, 12, 12);
          const col = node.kind === "scanner" ? 0x00e5ff : node.kind === "bridge" ? 0xffb020 : 0x8899aa;
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col }));
          scene.add(mesh);
          nodeMeshes[id] = mesh;
        }
        nodeMeshes[id].position.set(x, 0, z);
      });
      (hop.edges || []).slice(0, 30).forEach((e, i) => {
        const a = nodeMeshes[e.from];
        const b = nodeMeshes[e.to];
        if (a && b && i < 15) {
          const pts = [a.position.clone(), b.position.clone()];
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.5 })
          );
          scene.add(line);
        }
      });
    }

    async function loadScenarios() { const data = await client.getScenarios();
      scenarioEl.innerHTML = (data.scenarios || []).map((s) =>
        `<option value="${escapeHtml(s.id)}" ${s.id === data.active ? "selected" : ""}>${escapeHtml(s.label)}</option>`
      ).join("");
    }

    scenarioEl.addEventListener("change", async () => {
      await client.setScenario(scenarioEl.value as ScenarioId);
    });

    function renderTactical(tac) {
      if (!tac) return;
      missionPhaseEl.textContent = tac.missionLabel || "STANDBY";
      tickerEl.textContent = tac.ticker || "";
      const intf = tac.interference || {};
      interferenceEl.textContent = intf.label || "SPECTRUM CLEAR";
      interferenceEl.className = "interference " + (intf.level || "clear");

      chronoEl.innerHTML = (tac.chrono || []).slice().reverse().map((e) =>
        `<li><strong>${escapeHtml(e.type)}</strong> ${escapeHtml(e.message)}</li>`
      ).join("") || "<li>No events yet.</li>";

      const alerts = tac.alerts || [];
      alertsEl.innerHTML = alerts.length
        ? alerts.slice().reverse().map((a) => `<div class="alert-item">${escapeHtml(a.message)}</div>`).join("")
        : "No alerts.";

      relayEl.innerHTML = (tac.relayScores || []).map((r) =>
        `<div class="relay-row"><span>${escapeHtml(r.label)}</span><span>${r.score} pts · ${r.contacts} contacts · ${r.bridges} bridges</span></div>`
      ).join("") || "<div class='meta'>No relay nodes.</div>";

      breachChains.innerHTML = (tac.dominoBreaches || []).slice(0, 5).map((c) =>
        `<div class="breach-chain"><strong>${escapeHtml(c.breachLabel || c.target)}</strong><br>${(c.path || []).map(escapeHtml).join(" → ")}</div>`
      ).join("");

      document.body.classList.toggle("quantum-decoherence", intf.level === "critical");

      renderSciFi(tac.sciFi || {});
    }

    function renderSciFi(sci) {
      if (!sci) return;
      const lines = [
        `Theory corpus: ${sci.theoryCount ?? "?"} narrative→flaw→fix→code chains`,
        `Quorum confirmed: ${sci.quorumConfirmed ?? 0}`,
        `Clone clusters: ${(sci.cloneClusters || []).length}`,
        `Spoof alerts: ${(sci.spoofAlerts || []).length}`,
        `Resurrections: ${(sci.resurrections || []).length}`,
        `Anomalies: ${(sci.anomalies || []).length}`,
        `Cohort clusters: ${(sci.cohortClusters || []).length}`,
        `Listening posts: ${(sci.listeningPosts || []).length}`,
      ];
      sciFiPanel.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("");

      const worm = (sci.wormTimeline || []).slice(-8);
      if (worm.length) {
        sciFiPanel.innerHTML += "<div style='margin-top:0.5rem'><strong>Worm spread</strong><br>" +
          worm.map((w) => `depth ${w.maxHopDepth} @ ${new Date(w.ts * 1000).toLocaleTimeString()}`).join("<br>") + "</div>";
      }

      const tom = (sci.tomography || []).slice(0, 4);
      if (tom.length) {
        sciFiPanel.innerHTML += "<div style='margin-top:0.5rem'><strong>Tomography grid</strong><br>" +
          tom.map((z) => `${escapeHtml(z.node)}: heat ${z.heat}`).join("<br>") + "</div>";
      }

      const frames = sci.replayFrames || [];
      replaySlider.max = Math.max(0, frames.length - 1);
      replaySlider.value = frames.length ? frames.length - 1 : 0;
      replayPanel.textContent = frames.length
        ? `${frames.length} frames · latest ${frames[frames.length - 1].count} contacts`
        : "No frames yet.";
    }

    function renderIntelOverview(devices) {
      if (!devices.length) return;
      const beacons = devices.reduce((n, d) => n + ((d.passiveIntel?.beacons || []).length), 0);
      const hints = new Set();
      devices.forEach((d) => (d.passiveIntel?.ecosystemHints || []).forEach((h) => hints.add(h)));
      const pulled = devices.filter((d) => d.pullStatus === "ok").length;
      const locked = devices.filter((d) => d.exfilTier === "LOCKED").length;
      const partial = devices.filter((d) => d.exfilTier === "PARTIAL" || d.exfilTier === "OPEN").length;
      const passiveOnly = devices.filter((d) => d.exfilTier === "PASSIVE_ONLY").length;
      sciFiPanel.innerHTML +=
        `<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border)">
          <strong>Passive / GATT intel sweep</strong><br>
          Beacons decoded: ${beacons} · Ecosystem hints: ${hints.size}<br>
          GATT pulled: ${pulled} · open/partial: ${partial} · locked: ${locked} · passive-only: ${passiveOnly}
        </div>`;
    }

    replaySlider.addEventListener("input", async () => { const data = await client.getReplay();
      const f = (data.frames || [])[Number(replaySlider.value)];
      if (f) replayPanel.textContent = `Replay @ ${new Date(f.ts * 1000).toLocaleTimeString()} · ${f.count} contacts · hop ${f.maxHopDepth}`;
    });

    function flawTypeBadge(ft) {
      const t = ft || "technical";
      return `<span class="flaw-type ${escapeHtml(t)}">${escapeHtml(t)}</span>`;
    }

    function renderTheoryCard(t) {
      return `<div style="margin-bottom:0.45rem">
        <strong>${escapeHtml(t.id)}</strong>${flawTypeBadge(t.flawType)}
        <div>${escapeHtml(t.narrative)}</div>
        <span class="meta">Flaw: ${escapeHtml(t.flaw)}</span><br>
        <span class="meta">Fix: ${escapeHtml(t.fix)}</span>
        <code class="theory-code">${escapeHtml(t.code || "")}</code>
      </div>`;
    }

    function renderTheorySection(title, theories, filter) {
      const list = (theories || []).filter((t) => filter === "all" || t.flawType === filter);
      if (!list.length) return "";
      return `<div class="theory-section"><h3>${escapeHtml(title)} (${list.length})</h3>` +
        list.map(renderTheoryCard).join("") + "</div>";
    }

    function renderTheoriesPanel(data, filter) {
      if (!data) return;
      const f = filter || "all";
      theoriesPanel.innerHTML =
        `<div class="meta" style="margin-bottom:0.5rem">${escapeHtml(data.pattern || "")} · ${data.total || 0} chains</div>` +
        renderTheorySection("WiFi pose (PoseSense)", data.wifiPose, f) +
        renderTheorySection("Screen relay", data.screenRelay, f) +
        renderTheorySection("Security flaws", data.security, f) +
        renderTheorySection("Tactical sci-fi", data.tactical, f) +
        renderTheorySection("Passive intel", data.passive, f) +
        renderTheorySection("GATT exfil", data.gatt, f) +
        renderTheorySection("Architecture", data.architecture, f) ||
        "<div class='meta'>No theories match filter.</div>";

      const sec = data.securitySummary || {};
      securitySummaryEl.innerHTML = sec.devicesTracked != null
        ? `<strong>Live security posture</strong><br>
           Tracked: ${sec.devicesTracked} · GATT locked: ${sec.gattLocked ?? 0} ·
           Serials: ${sec.serialsExposed ?? 0} · Health reads: ${sec.healthReads ?? 0}<br>
           <span class="meta">${escapeHtml(sec.operatorNote || "")}</span>`
        : "";
    }

    function renderDeviceTheories(theories) {
      if (!theories || !theories.length) return "";
      const cards = theories.slice(0, 8).map((t) =>
        `<div class="theory-chain"><strong>${escapeHtml(t.id)}</strong>${flawTypeBadge(t.flawType)}
        ${escapeHtml(t.chain || `${t.narrative} → ${t.fix}`)}</div>`
      ).join("");
      const more = theories.length > 8 ? `<div class="meta">+ ${theories.length - 8} more theory chains</div>` : "";
      return `<div class="intel-block"><h4>Applicable theories (${theories.length})</h4>${cards}${more}</div>`;
    }

    async function loadTheories(filter) {
      if (!theoryCache) { theoryCache = await client.getTheories(); }
      renderTheoriesPanel(theoryCache, filter || theoryFilterEl?.value || "all");
    }

    function renderThreatBoard(devices) {
      if (!devices.length) { threatBoard.textContent = "No contacts."; return; }
      const ranked = [...devices].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      threatRotate = (threatRotate + 1) % ranked.length;
      const top = ranked.slice(threatRotate, threatRotate + 3).concat(ranked.slice(0, Math.max(0, 3 - (ranked.length - threatRotate))));
      threatBoard.innerHTML = top.map((d, i) =>
        `<div style="padding:0.3rem 0"><strong>#${i + 1} ${escapeHtml(d.displayName || d.id)}</strong>
        <span class="sci-tag">${escapeHtml(d.threatTier || "?")}</span>
        ${exfilTierBadge(d.exfilTier)}
        <span class="meta">RSSI ${d.rssi ?? "?"} · ${escapeHtml((d.sciFi?.quorum?.status) || "?")} · pull ${escapeHtml(d.pullStatus || "?")}</span></div>`
      ).join("");
    }

    function renderDevices(devices: ScannedDevice[]) {
      if (!devices.length) {
        listEl.innerHTML = "<li class='meta'>No signal contacts.</li>";
        return;
      }
      listEl.innerHTML = devices.map((d) => {
        const tier = d.threatTier || "unknown";
        const pri = d.onWatchlist ? " priority" : "";
        const ring = d.proximityZone === "immediate" ? '<div class="ring"></div>' : "";
        const trend = TREND_LABELS[d.movementTrend] || "";
        const fp = d.fingerprint ? `<span class="meta">Signature: <code>${escapeHtml(d.fingerprint)}</code></span>` : "";
        const watchBtn = `<button type="button" class="watchBtn" data-id="${escapeHtml(d.id)}">${d.onWatchlist ? "★ LOCKED" : "☆ LOCK"}</button>`;
        const pullBtn = `<button type="button" class="pullBtn" data-id="${escapeHtml(d.id)}">PULL GATT</button>`;
        const relayBtn = `<button type="button" class="relayBtn" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.displayName || d.name || "")}">SCREEN RELAY</button>`;
        const dossierId = "dossier-" + escapeHtml(d.id).replace(/:/g, "");
        const intelId = "intel-" + escapeHtml(d.id).replace(/:/g, "");
        const teamClass = !redBlueToggle.checked ? "" :
          d.threatTier === "friendly" || d.threatTier === "known" ? " team-blue" :
          d.onWatchlist ? " team-purple" : " team-red";
        const sci = d.sciFi || {};
        const tags = [
          sci.dialect?.dialect,
          sci.quorum?.status,
          sci.pursuit?.bearing,
          sci.geofence?.breach ? "BREACH" : null,
        ].filter(Boolean).map((t) => `<span class="sci-tag">${escapeHtml(t)}</span>`).join("");
        const pullLabel = { pending: "queued", ok: "pulled", failed: "blocked", empty: "empty", hop_relay: "hop relay" }[d.pullStatus] || d.pullStatus;
        const hopRelayTag = d.hopRelayOnly
          ? `<span class="sci-tag">HOP RELAY · ${escapeHtml(d.reportedByScanner || "?")}</span>`
          : (d.alsoReportedBy?.length ? `<span class="sci-tag">also via ${escapeHtml(d.alsoReportedBy.join(", "))}</span>` : "");
        const hopDepthLabel = d.hopDepth != null ? ` · hop ${d.hopDepth}` : "";
        return `<li class="device${pri}${teamClass}" data-id="${escapeHtml(d.id)}">
          ${ring}
          <strong>${escapeHtml(d.displayName || d.name || "Unknown")}
            <span class="tier ${escapeHtml(tier)}">${TIER_LABELS[tier] || tier}</span>
            ${exfilTierBadge(d.exfilTier)}
            <span class="pull-status">pull: ${escapeHtml(pullLabel || "?")}${hopDepthLabel}</span>
          </strong>
          <span class="meta">~${escapeHtml(d.distanceLabel || "?")} · RSSI ${d.rssi ?? "?"} dBm · ${trend}</span>
          <div>${tags}${hopRelayTag}</div>
          <span class="meta">MAC <code>${escapeHtml(d.macAddress || d.id)}</code>${d.identityAddress ? ` · identity <code>${escapeHtml(d.identityAddress)}</code>` : ""}</span>
          ${fp}
          <div class="device-actions">
            ${watchBtn}
            ${pullBtn}
            ${relayBtn}
            <button type="button" class="dossierBtn" data-target="${dossierId}">TACTICAL DOSSIER</button>
            <button type="button" class="intelToggleBtn" data-target="${intelId}">INTEL PANEL</button>
          </div>
          <div class="intel-block" id="${intelId}" style="display:none">${renderDeviceIntel(d)}</div>
          <div class="dossier" id="${dossierId}">Loading…</div>
        </li>`;
      }).join("");

      document.querySelectorAll(".watchBtn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await client.toggleWatchlist(btn.dataset.id!);
          await poll();
        });
      });
      document.querySelectorAll(".relayBtn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await startRelaySession(btn.dataset.id, btn.dataset.name);
          screenRelayPanel.parentElement.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      document.querySelectorAll(".pullBtn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          btn.textContent = "PULLING…";
          try {
            const data = await client.pullDeviceData(btn.dataset.id!);
            showToast(`GATT pull · tier ${data.exfilTier || "?"}`);
            await poll();
          } catch (e) {
            showToast(e instanceof Error ? e.message : "Pull failed");
          } finally {
            btn.disabled = false;
            btn.textContent = "PULL GATT";
          }
        });
      });
      document.querySelectorAll(".intelToggleBtn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const box = document.getElementById(btn.dataset.target);
          if (!box) return;
          const open = box.style.display !== "none";
          box.style.display = open ? "none" : "block";
          btn.textContent = open ? "INTEL PANEL" : "HIDE INTEL";
        });
      });
      document.querySelectorAll(".dossierBtn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const li = btn.closest(".device");
          const id = li.dataset.id;
          const box = document.getElementById(btn.dataset.target);
          if (li.classList.toggle("open") && box.textContent === "Loading…") {
            const dossier = await client.getDossier(id);
            const passive = dossier.passiveIntel ? renderPassiveIntel(dossier.passiveIntel) : "";
            const gatt = renderGattFields({
              pulledData: dossier.pulledIntel,
              charLabels: dossier.charLabels,
              intelSummary: dossier.intelSummary,
              exfilTier: dossier.exfilTier,
              pullStatus: dossier.pullStatus,
            });
            const atlas = renderGattAtlas(dossier.gattAtlas);
            const th = renderDeviceTheories(dossier.theories);
            box.innerHTML = passive + gatt + atlas + th +
              `<pre style="white-space:pre-wrap;margin:0.5rem 0 0;font-size:0.68rem;">${escapeHtml(JSON.stringify(dossier, null, 2))}</pre>`;
          }
        });
      });
    }

    function applySnapshot(data: ScanSnapshot) {
      const tac = data.tactical;
      renderTactical(tac);
      renderDevices(data.devices ?? []);
      renderIntelOverview(data.devices ?? []);
      renderThreatBoard(data.devices ?? []);
      loadScreenRelay();
      loadPoseSense();
      if (theoryCache) {
        theoryCache.securitySummary = theoryCache.securitySummary || {};
        const devs = data.devices ?? [];
        theoryCache.securitySummary.devicesTracked = devs.length;
        theoryCache.securitySummary.gattLocked = devs.filter((d) => d.exfilTier === "LOCKED").length;
        theoryCache.securitySummary.serialsExposed = devs.filter((d) => d.pulledData?.data?.serialNumber).length;
        theoryCache.securitySummary.healthReads = devs.filter((d) => d.pulledData?.data?.heartRateBpm != null).length;
        renderTheoriesPanel(theoryCache, theoryFilterEl?.value || "all");
      }
      updateTacticalMap(data);
      updateBattlefield(data.hopGraph);
      hopStats.textContent = data.hopGraph
        ? `${data.hopGraph.scannerCount} scanner(s) · ${data.hopGraph.nodeCount} nodes · max depth ${data.hopGraph.maxHopDepth}` +
          (data.hopRelay
            ? ` · ${data.hopRelay.directContacts} direct + ${data.hopRelay.relayOnlyContacts} hop-relayed → root map`
            : "")
        : "";

      const count = data.count || 0;
      if (count > lastCount && data.phase === "running") {
        playBlip(300 + Math.min(count * 20, 400), 0.05);
      }
      lastCount = count;

      if (tac?.alerts?.length) {
        const latest = tac.alerts[tac.alerts.length - 1];
        if (latest && Date.now() / 1000 - latest.ts < 3) showToast(latest.message);
      }

      if (data.scannerLocation?.addressShort) {
        locEl.innerHTML = `<strong>Scanner position:</strong> ${escapeHtml(data.scannerLocation.addressShort)}`;
      }

      const phaseLabels = { running: "SWEEP", resolving: "DECRYPT", pulling: "EXFIL", completed: "COMPLETE", failed: "LOST" };
      if (data.phase === "running") {
        const elapsed = data.startedAt ? Math.floor(Date.now() / 1000 - data.startedAt) : 0;
        const hops = data.hopIngestCount ?? 0;
        const depth = data.hopGraph?.maxHopDepth ?? 0;
        statusEl.textContent =
          `CONTINUOUS SWEEP · ${count} contact(s) · ${elapsed}s · hop syncs ${hops} · chain depth ${depth}`;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        return;
      }
      if (data.phase === "resolving" || data.phase === "pulling") {
        statusEl.textContent = `${phaseLabels[data.phase] || data.phase}… ${count} device(s) — sweep continues`;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        return;
      }

      if (data.phase === "failed") {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusEl.textContent = data.error || "Signal lost.";
        return;
      }

      // Persistent mode: keep polling even if phase label is idle/completed
      if (data.persistent && data.phase !== "failed") {
        if (!pollTimer) {
          pollTimer = setInterval(poll, 400);
        }
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = `CONTINUOUS SWEEP · ${count} contact(s)`;
        return;
      }

      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      startBtn.disabled = false;
      stopBtn.disabled = true;
      statusEl.textContent = count ? `Standing by · ${count} contact(s)` : "Standing by.";
    }

    async function poll() { applySnapshot(await client.getDevices()); }

    async function refreshHealth() { try { const data = await client.checkHealth();
        healthEl.className = data.ready ? "ok" : "bad";
        healthEl.textContent = data.ready ? "● RADIO ONLINE" : "✕ " + data.message;
        startBtn.disabled = !data.ready || pollTimer !== null;
        return data.ready;
      } catch {
        healthEl.className = "bad";
        healthEl.textContent = "Server offline — run: python ble-scan-server.py";
        startBtn.disabled = true;
        return false;
      }
    }

    async function startScan() { statusEl.textContent = "Initiating sweep…"; try { await client.triggerScan(); } catch (e) { statusEl.textContent = (e instanceof Error ? e.message : "Sweep failed."); await refreshHealth(); return; }
      playBlip(220, 0.2);
      stopBtn.disabled = false;
      pollTimer = setInterval(poll, 400);
      poll();
    }

    async function stopScan() { await client.stopScan().catch(() => {});
      playBlip(520, 0.1);
      await poll();
    }

    async function bootSweep() {
      const ready = await refreshHealth();
      if (!ready) return;
      pollTimer = setInterval(poll, 400);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          await client.setScannerLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          await poll();
        }, () => {}, { enableHighAccuracy: true, timeout: 12000 });
      }
      try {
        const data = await client.triggerScan();
        if (data.ok || data.alreadyRunning) {
          playBlip(220, 0.15);
          stopBtn.disabled = false;
        }
      } catch (_) {}
      await poll();
    }

    extractBtn.addEventListener("click", () => {
      const cipher = confirm("Use cipher exfil? OK = password-protected, Cancel = plain ZIP");
      if (cipher) {
        const pw = prompt("Exfil password:");
        if (pw) window.location.href = client.extractionUrl("cipher", pw);
      } else {
        window.location.href = client.extractionUrl("zip");
      }
    });

    briefBtn.addEventListener("click", () => { window.open(client.briefUrl(), "_blank"); });

    voiceBtn.addEventListener("click", () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { showToast("Voice not supported in this browser"); return; }
      const rec = new SR();
      rec.onresult = async (ev) => {
        const cmd = (ev.results[0][0].transcript || "").toLowerCase();
        if (cmd.includes("sync") || cmd.includes("hop")) { await stopScan(); showToast("Hop sync"); }
        else if (cmd.includes("brief")) { window.open(client.briefUrl(), "_blank"); }
        else if (cmd.includes("status")) { await poll(); showToast(statusEl.textContent); }
        else showToast("Heard: " + cmd);
      };
      rec.start();
      showToast("Voice commander listening…");
    });

    locBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { locEl.textContent = "Geolocation unavailable."; return; }
      navigator.geolocation.getCurrentPosition(async (pos) => {
        await client.setScannerLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        await poll();
      });
    });

    startBtn.addEventListener("click", startScan);
    stopBtn.addEventListener("click", stopScan);

    function connectSSE() { const es = client.openWarRoomStream((e) => { tickerEl.textContent = e.message; }); es.onopen = () => { sseStatus.textContent = "● War room link ACTIVE"; };
      es.onerror = () => {
        sseStatus.textContent = "Stream reconnecting…";
        es.close();
        setTimeout(connectSSE, 3000);
      };
    }

    initBattlefield();
    if (typeof L !== "undefined") {
      const m = document.getElementById("tacticalMap");
      if (m) {
        tacticalMap = L.map("tacticalMap").setView([20, 0], 2);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OSM &copy; CARTO", subdomains: "abcd", maxZoom: 20,
        }).addTo(tacticalMap);
        tacticalMap.on("dragstart", () => { tacticalMap._userPanned = true; });
      }
    }
    loadScenarios();
    loadTheories();
    loadPoseSense();
    theoryFilterEl?.addEventListener("change", () => loadTheories(theoryFilterEl.value));
    bootSweep();
    connectSSE();