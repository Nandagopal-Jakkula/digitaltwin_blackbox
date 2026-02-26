// =======================
// Client-side app code (migrated from combined_ifc_thingspeak.html)
// Fetches detection results from server and updates UI/Cesium
// =======================

const LEAK_PRESSURE_THRESHOLD = 1.0; // fallback if server not used
const LEAK_FLOW_THRESHOLD = 1.0;

// Dynamic backend URL - detects environment automatically
// For local development: uses localhost
// For cloud deployment: uses the deployed server URL
const getBackendUrl = () => {
  // Check if there's a custom API URL defined (for cloud deployment)
  if (window.API_URL) {
    return window.API_URL;
  }
  // Check if running on localhost
  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname === '0.0.0.0';
  if (isLocalhost) {
    return 'http://127.0.0.1:5000';
  }
  // For deployed version, use relative path (same domain)
  return '';
};

const BACKEND_URL = getBackendUrl();
const API_ENDPOINT = BACKEND_URL ? `${BACKEND_URL}/api` : '/api';
const DETECT_ENDPOINT = `${API_ENDPOINT}/detect`;
const LATEST_ENDPOINT = `${API_ENDPOINT}/latest`;

console.log('[App] Backend URL:', BACKEND_URL);
console.log('[App] Detect Endpoint:', DETECT_ENDPOINT);
console.log('[App] Latest Endpoint:', LATEST_ENDPOINT);

let allPipes = [];
let filteredPipes = [];
let selectedPipeId = null;
let pipeFeatures = {};

// Helper function to calculate leak status client-side (fallback)
function calculateLeakStatus(pressure, flow) {
  if (pressure === null || flow === null) return 'unknown';
  if (pressure < LEAK_PRESSURE_THRESHOLD || flow < LEAK_FLOW_THRESHOLD) {
    return 'leak';
  }
  return 'normal';
}

function toggleDashboard() {
  const panel = document.getElementById('dashboardPanel');
  panel.classList.toggle('collapsed');
}

function filterPipes() {
  const searchTerm = document.getElementById('pipeSearch').value.toLowerCase();
  filteredPipes = allPipes.filter(pipe =>
    pipe.pipeId.toLowerCase().includes(searchTerm) ||
    pipe.pSensorId?.toLowerCase().includes(searchTerm) ||
    pipe.fSensorId?.toLowerCase().includes(searchTerm)
  );
  renderPipeList();
}

function renderPipeList() {
  const container = document.getElementById('pipeList');

  if (filteredPipes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No pipes found</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredPipes.map(pipe => `
    <div class="pipe-card ${pipe.pipeId === selectedPipeId ? 'selected' : ''}"
         onclick="selectPipe('${pipe.pipeId}')">
      <div class="pipe-header">
        <span class="pipe-id">${pipe.pipeId}</span>
        <span class="status-dot ${pipe.leakStatus === 'leak' ? 'leak' : ''}"></span>
      </div>
      <div class="sensor-data">
        <div class="sensor-item">
          <div class="sensor-label">Pressure Δ</div>
          <div class="sensor-value pressure">
            ${pipe.pressureDelta !== null ? (pipe.pressureDelta > 0 ? '+' : '') + pipe.pressureDelta.toFixed(2) : '--'}
            <span class="unit">Bar</span>
          </div>
        </div>
        <div class="sensor-item">
          <div class="sensor-label">Flow Δ</div>
          <div class="sensor-value flow">
            ${pipe.flowDelta !== null ? (pipe.flowDelta > 0 ? '+' : '') + pipe.flowDelta.toFixed(3) : '--'}
            <span class="unit">L/min</span>
          </div>
        </div>
      </div>
      ${pipe.leakStatus === 'leak' ? `<div style="margin-top:8px;color:#ff6b6b;font-weight:700">LEAK DETECTED</div>` : ''}
    </div>
  `).join('');
}

function updateStats() {
  const validPipes = allPipes.filter(p => p.pressureDelta !== null && p.flowDelta !== null);
  document.getElementById('totalPipes').textContent = allPipes.length;
  if (validPipes.length > 0) {
    const avgPressureDelta = validPipes.reduce((s, p) => s + p.pressureDelta, 0) / validPipes.length;
    document.getElementById('avgPressure').textContent = avgPressureDelta.toFixed(1);
  }
  const leaks = allPipes.filter(p => p.leakStatus === 'leak').length;
  const leakEl = document.getElementById('leakCount');
  if (leakEl) leakEl.textContent = leaks;
}

function updateTimestamp() {
  const now = new Date();
  document.getElementById('lastUpdated').textContent = now.toLocaleTimeString();
}

function selectPipe(pipeId) {
  selectedPipeId = pipeId;
  renderPipeList();

  const feature = pipeFeatures[pipeId];
  if (feature) {
    window.viewer.zoomTo(feature);
    if (window.selectedFeature && window.originalColor) {
      window.selectedFeature.color = window.originalColor.clone();
    }
    window.selectedFeature = feature;
    window.originalColor = feature.color.clone();
    feature.color = Cesium.Color.DARKBLUE.withAlpha(0.9);
  }
}

// Helper: same logic as client-side before — extract digits and map to 'fieldN'
function fieldKeyFromId(fieldId) {
  if (!fieldId) return null;
  const m = String(fieldId).match(/(\d+)/);
  if (!m) return null;
  return 'field' + m[1];
}

// POST pipes to server for detection; server returns pressures, flows and leakStatus
async function fetchServerDetection() {
  try {
    if (allPipes.length === 0) {
      console.warn('[fetchServerDetection] No pipes to detect, skipping call');
      return;
    }

    const pipesPayload = allPipes.map(p => ({ 
      pipeId: p.pipeId, 
      pFieldIn: p.pFieldIn,
      pFieldOut: p.pFieldOut,
      fFieldIn: p.fFieldIn,
      fFieldOut: p.fFieldOut
    }));

    console.log(`[fetchServerDetection] Sending ${allPipes.length} pipes to ${DETECT_ENDPOINT}`);

    const resp = await fetch(DETECT_ENDPOINT, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ pipes: pipesPayload }),
      timeout: 10000
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    let data;
    try {
      data = await resp.json();
    } catch (parseErr) {
      console.error('[fetchServerDetection] Failed to parse JSON response', parseErr);
      console.debug('[fetchServerDetection] Response text:', await resp.text());
      return;
    }

    if (!data || !Array.isArray(data.pipes)) {
      console.warn('[fetchServerDetection] Invalid response structure, expected {pipes: []}', data);
      return;
    }

    // update local allPipes by pipeId
    let updatedCount = 0;
    for (const p of data.pipes) {
      const target = allPipes.find(x => x.pipeId === p.pipeId);
      if (target) {
        target.pressureIn = (p.pressureIn === null) ? null : Number(p.pressureIn);
        target.pressureOut = (p.pressureOut === null) ? null : Number(p.pressureOut);
        target.flowIn = (p.flowIn === null) ? null : Number(p.flowIn);
        target.flowOut = (p.flowOut === null) ? null : Number(p.flowOut);
        target.pressureDelta = (p.pressureDelta === null) ? null : Number(p.pressureDelta);
        target.flowDelta = (p.flowDelta === null) ? null : Number(p.flowDelta);
        target.leakStatus = p.leakStatus || 'normal';
        updatedCount++;
      }
    }

    console.log(`[fetchServerDetection] Updated ${updatedCount}/${allPipes.length} pipes`);
    
    filterPipes();
    updateStats();
    updateTimestamp();
  } catch (e) {
    console.error('[fetchServerDetection] Error:', {
      message: e.message,
      stack: e.stack,
      endpoint: DETECT_ENDPOINT
    });
  }
}


// Fetch latest ThingSpeak data directly (fallback) and update pipes via updatePipeData
async function fetchLatestTS() {
  try {
    console.log(`[fetchLatestTS] Fetching from ${LATEST_ENDPOINT}`);

    const resp = await fetch(LATEST_ENDPOINT, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    let latest;
    try {
      latest = await resp.json();
    } catch (parseErr) {
      console.error('[fetchLatestTS] Failed to parse JSON response', parseErr);
      console.debug('[fetchLatestTS] Response text:', await resp.text());
      return;
    }

    if (!latest || typeof latest !== 'object') {
      console.warn('[fetchLatestTS] Invalid response, expected object', latest);
      return;
    }

    console.log('[fetchLatestTS] Received ThingSpeak data with keys:', Object.keys(latest).join(', '));
    
    // server returns the raw latest ThingSpeak JSON; use updatePipeData to map fields
    updatePipeData(latest);
  } catch (e) {
    console.error('[fetchLatestTS] Error:', {
      message: e.message,
      stack: e.stack,
      endpoint: LATEST_ENDPOINT
    });
  }
}

window.addEventListener('load', async () => {
  // Cesium initialization is kept in the same shape as before
  Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxYzg3MjkzNy1hN2ZiLTQ1NDktYTZmZS0wMDZhNTg0MDE3NDQiLCJpZCI6MjkwNTA4LCJpYXQiOjE3NjczODM0MzB9.uiMKbic_hC7EnSfVJD1t0cMg7qjVDmlBgTTiiCvKQDk";

  const viewer = new Cesium.Viewer('cesiumContainer', { animation: false, timeline: false, baseLayerPicker: false, imageryProvider: false, infoBox: false });
  window.viewer = viewer;

  const ALLOWED_IFC_PROPERTIES = [
    'textwaterpressuresensoridout','textoutflowsensorid','textassociatedPressureSensorID','textassociatedFlowSensorID','textInstallationType','dimensionsburieddepth','textwaterpressuresensoridin','textPipeID','textPipeMaterial','textinflowsensorid'
  ];

  // minimal infoBox overlay code preserved (omitted here for brevity in example)
  const infoBoxOverlay = document.createElement('div');
  infoBoxOverlay.id = 'infoBoxOverlay';
  infoBoxOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9998; display: none;';
  document.body.appendChild(infoBoxOverlay);
  const infoBoxPanel = document.createElement('div');
  infoBoxPanel.id = 'infoBoxPanel';
  infoBoxPanel.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 420px; max-height: 75vh; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; box-shadow: 0 12px 50px rgba(0,0,0,0.7); z-index: 9999; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; overflow: hidden; display: none;';
  document.body.appendChild(infoBoxPanel);

  function closeIFCDetails() { document.getElementById('infoBoxPanel').style.display = 'none'; document.getElementById('infoBoxOverlay').style.display = 'none'; }

  function showIFCDetails(feature) {
    if (!feature || typeof feature.getPropertyIds !== 'function') return;

    const propertyIds = feature.getPropertyIds();
    const filteredProps = {};

    for (const id of propertyIds) {
      if (ALLOWED_IFC_PROPERTIES.includes(id)) {
        const value = feature.getProperty(id);
        if (value !== undefined && value !== null && value !== '') {
          filteredProps[id] = value;
        }
      }
    }

    const panel = document.getElementById('infoBoxPanel');

    if (Object.keys(filteredProps).length === 0) {
      panel.innerHTML = `
        <div style="background: linear-gradient(90deg, #0f3460 0%, #533483 100%); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
          <span style="color: white; font-weight: 600; font-size: 16px;">PIPE DETAILS</span>
          <span onclick="closeIFCDetails()" style="cursor: pointer; color: white; font-size: 24px; line-height: 1;">&times;</span>
        </div>
        <div style="padding: 40px; color: #888; text-align: center;">
          No details available
        </div>
      `;
    } else {
      const rows = Object.entries(filteredProps).map(([key, value]) => {
        const displayKey = key
          .replace(/text/gi, '')
          .replace(/ID/gi, ' ID')
          .replace(/([A-Z])/g, ' $1')
          .replace(/^ /, '')
          .trim()
          .toUpperCase();

        return `
          <div style="padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #aaa; font-size: 12px; font-weight: 500;">${displayKey}</span>
            <span style="color: white; font-size: 13px; font-weight: 500; text-align: right; max-width: 220px; word-break: break-word; margin-left: 20px;">${value}</span>
          </div>
        `;
      }).join('');

      panel.innerHTML = `
        <div style="background: linear-gradient(90deg, #0f3460 0%, #533483 100%); padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
          <span style="color: white; font-weight: 600; font-size: 16px;">PIPE DETAILS</span>
          <span onclick="closeIFCDetails()" style="cursor: pointer; color: white; font-size: 24px; line-height: 1;">&times;</span>
        </div>
        <div style="max-height: calc(75vh - 60px); overflow-y: auto;">
          ${rows}
        </div>
      `;
    }

    panel.style.display = 'block';
    infoBoxOverlay.style.display = 'block';
  }

  // Make functions globally accessible
  window.closeIFCDetails = closeIFCDetails;
  window.showIFCDetails = showIFCDetails;

  viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
  viewer.scene.globe.show = true; viewer.scene.skyBox.show = false; viewer.scene.backgroundColor = Cesium.Color.BLACK;

  const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(4356579);
  viewer.scene.primitives.add(tileset);
  await viewer.zoomTo(tileset);

  const SENSOR_CACHE = {};
  tileset.tileVisible.addEventListener(tile => {
    const content = tile.content; if (!content || !content.featuresLength) return;
    for (let i = 0; i < content.featuresLength; i++) {
      const f = content.getFeature(i);
      const sensorId = getProp(f, 'textSensorID');
      if (sensorId && !SENSOR_CACHE[sensorId]) SENSOR_CACHE[sensorId] = f;
    }
  });

  function getProp(feature, name) { if (!feature || typeof feature.getProperty !== 'function') return undefined; return feature.getProperty(name); }
  function findSensorFeature(sensorId) { if (!sensorId) return null; return SENSOR_CACHE[sensorId] || null; }

  function getTSValueFromIFCField(fieldId, latestTSData) {
    if (!fieldId || !latestTSData) return null;
    const match = String(fieldId).match(/(\d+)/);
    if (!match) return null;
    const key = 'field' + match[1];
    const raw = latestTSData[key];
    if (raw === undefined || raw === null) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }

  // Update pipes from a ThingSpeak/latestTS data object and compute leak status
  function updatePipeData(latestTSData) {
    if (!latestTSData) return;
    console.debug('updatePipeData: latest keys', Object.keys(latestTSData || {}));
    for (const pipe of allPipes) {
      const pressure = getTSValueFromIFCField(pipe.pField, latestTSData);
      const flow = getTSValueFromIFCField(pipe.fField, latestTSData);
      pipe.pressure = pressure;
      pipe.flow = flow;
      // Compute leak status client-side (fallback) using existing thresholds
      pipe.leakStatus = calculateLeakStatus(pressure, flow);
      if (pressure === null || flow === null) {
        console.debug('updatePipeData: missing values for', pipe.pipeId, { pField: pipe.pField, fField: pipe.fField, pressure, flow });
      }
    }
    // Refresh filtered list, stats and timestamp
    filterPipes();
    updateStats();
    updateTimestamp();
  }

  function collectPipes() {
    allPipes = []; pipeFeatures = {};
    const tiles = tileset._selectedTiles; if (!tiles) return;
    let skippedCount = 0;
    for (const tile of tiles) {
      const c = tile.content; if (!c || !c.featuresLength) continue;
      for (let i = 0; i < c.featuresLength; i++) {
        const f = c.getFeature(i);
        const pipeId = getProp(f, 'textPipeID');
        if (pipeId) {
          // Collect IN sensors
          const pSensorIdIn = getProp(f, 'textwaterpressuresensoridin');
          const fSensorIdIn = getProp(f, 'textinflowsensorid');
          // Collect OUT sensors
          const pSensorIdOut = getProp(f, 'textwaterpressuresensoridout');
          const fSensorIdOut = getProp(f, 'textoutflowsensorid');
          
          // Only include pipes with BOTH in AND out pressure sensors
          if (!pSensorIdIn || !pSensorIdOut) {
            console.log(`[collectPipes] Skipping ${pipeId}: missing pressure sensor (in: ${pSensorIdIn}, out: ${pSensorIdOut})`);
            skippedCount++;
            continue;
          }
          
          // Find sensor features
          const pSensorIn = findSensorFeature(pSensorIdIn);
          const fSensorIn = findSensorFeature(fSensorIdIn);
          const pSensorOut = findSensorFeature(pSensorIdOut);
          const fSensorOut = findSensorFeature(fSensorIdOut);
          
          // Extract ThingSpeak field IDs
          const pFieldIn = getProp(pSensorIn, 'textfieldid');
          const fFieldIn = getProp(fSensorIn, 'textfieldid');
          const pFieldOut = getProp(pSensorOut, 'textfieldid');
          const fFieldOut = getProp(fSensorOut, 'textfieldid');
          
          pipeFeatures[pipeId] = f;
          allPipes.push({ 
            pipeId, 
            pSensorIdIn, fSensorIdIn, pSensorIdOut, fSensorIdOut,
            pFieldIn, fFieldIn, pFieldOut, fFieldOut,
            pressureIn: null, flowIn: null, pressureOut: null, flowOut: null,
            pressureDelta: null, flowDelta: null,
            leakStatus: 'normal' 
          });
        }
      }
    }
    filteredPipes = [...allPipes]; updateStats(); renderPipeList(); console.log(`[collectPipes] Collected ${allPipes.length} pipes (skipped ${skippedCount} without both in/out sensors)`);
  }

  setTimeout(() => {
    collectPipes();
    // initial server detection and then periodic
    fetchServerDetection();
    fetchLatestTS();
    setInterval(fetchServerDetection, 10000);
    setInterval(fetchLatestTS, 10000);
  }, 2000);

  // Hover tooltip and click handlers
  const hoverDiv = document.createElement('div');
  hoverDiv.style.cssText = 'position:absolute;background:rgba(0,0,0,0.9);color:white;padding:10px 14px;border-radius:8px;font-size:13px;pointer-events:none;display:none;z-index:1000;box-shadow:0 4px 15px rgba(0,0,0,0.4);border:1px solid rgba(0,217,255,0.3);';
  document.body.appendChild(hoverDiv);

  let selectedFeature = null; let originalColor = null; window.selectedFeature = selectedFeature; window.originalColor = originalColor;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    if (!Cesium.defined(picked) || !picked.getProperty) return;
    const pipeId = getProp(picked, 'textPipeID'); if (!pipeId) return;
    if (selectedFeature && originalColor) selectedFeature.color = originalColor.clone();
    selectedFeature = picked; originalColor = picked.color.clone(); picked.color = Cesium.Color.DARKBLUE.withAlpha(0.9);
    window.selectedFeature = selectedFeature; window.originalColor = originalColor;
    selectPipe(pipeId);
    showIFCDetails(picked);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.endPosition);
    if (!Cesium.defined(picked) || !picked.getProperty) { hoverDiv.style.display = 'none'; return; }
    const pipeId = getProp(picked, 'textPipeID'); if (!pipeId) { hoverDiv.style.display = 'none'; return; }
    
    // Get cached values from allPipes
    const pipeObj = allPipes.find(x => x.pipeId === pipeId);
    if (!pipeObj) { hoverDiv.style.display = 'none'; return; }
    
    const pressureDelta = pipeObj.pressureDelta ?? null;
    const flowDelta = pipeObj.flowDelta ?? null;
    
    // Calculate leak status based on delta thresholds
    const leakStatus = (pressureDelta !== null && pressureDelta > LEAK_PRESSURE_THRESHOLD) || (flowDelta !== null && flowDelta > LEAK_FLOW_THRESHOLD) ? 'leak' : (pressureDelta === null || flowDelta === null ? 'unknown' : 'normal');
    const leakColor = leakStatus === 'leak' ? '#ff4757' : (leakStatus === 'unknown' ? '#888' : '#4CAF50');
    const leakText = leakStatus === 'leak' ? '⚠ LEAK DETECTED' : (leakStatus === 'unknown' ? 'Status Unknown' : '✓ Normal');
    
    hoverDiv.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;color:#00d9ff">${pipeId}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <div style="color:#888;font-size:10px">PRESSURE Δ</div>
          <div style="color:#ff6b6b;font-weight:600">${pressureDelta !== null ? (pressureDelta > 0 ? '+' : '') + pressureDelta.toFixed(2) : '--'} Bar</div>
        </div>
        <div>
          <div style="color:#888;font-size:10px">FLOW Δ</div>
          <div style="color:#4ecdc4;font-weight:600">${flowDelta !== null ? (flowDelta > 0 ? '+' : '') + flowDelta.toFixed(3) : '--'} L/min</div>
        </div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
        <div style="color:#888;font-size:10px">STATUS</div>
        <div style="color:${leakColor};font-weight:600;font-size:12px">${leakText}</div>
      </div>
    `;
    hoverDiv.style.left = movement.endPosition.x + 15 + 'px'; hoverDiv.style.top = movement.endPosition.y + 15 + 'px'; hoverDiv.style.display = 'block';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  console.log('Dashboard initialized successfully');
});
