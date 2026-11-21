// PolyglotForge Client Core & Dashboard Controller
const ForgeApp = (() => {
  let sseSource = null;
  let currentChaos = { globalEnabled: false };
  let activeEndpoints = [];

  // Initialize common UI components
  function init() {
    setupMobileNav();
    setupSse();
    setupMasterChaosToggle();
    fetchStatus();
  }

  // --- Mobile Navigation Drawer ---
  function setupMobileNav() {
    const btn = document.getElementById('menuBtn');
    const links = document.getElementById('navLinks');
    if (btn && links) {
      btn.addEventListener('click', () => {
        links.classList.toggle('open');
      });
    }
  }

  // --- Live SSE Stream ---
  function setupSse() {
    const indicator = document.getElementById('liveIndicator');
    const liveText = document.getElementById('liveText');

    function connect() {
      if (sseSource) sseSource.close();
      sseSource = new EventSource('/api/traffic/stream');

      sseSource.addEventListener('open', () => {
        if (indicator) indicator.style.display = 'inline-flex';
        if (liveText) liveText.textContent = 'LIVE FEED';
      });

      sseSource.addEventListener('connected', (e) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Connected to PolyglotForge traffic stream', data);
      });

      sseSource.addEventListener('traffic_event', (e) => {
        const data = JSON.parse(e.data);
        handleTrafficEvent(data);
      });

      sseSource.addEventListener('chaos_updated', (e) => {
        const data = JSON.parse(e.data);
        currentChaos = data.chaos;
        updateChaosMasterUI(data.chaos.globalEnabled);
      });

      sseSource.addEventListener('error', () => {
        if (liveText) liveText.textContent = 'CONNECTING...';
        sseSource.close();
        setTimeout(connect, 3000); // Auto reconnect
      });
    }

    connect();
  }

  function handleTrafficEvent(data) {
    // Update live metrics on dashboard if present
    if (data.metrics) {
      updateMetricElement('rpsVal', data.metrics.rps);
      updateMetricElement('totalRequestsVal', data.metrics.totalRequests);
      updateMetricElement('avgLatencyVal', `${data.metrics.avgLatencyMs}ms`);
      updateMetricElement('errorRateVal', `${data.metrics.errorRate}%`);
    }

    // Call window hook if traffic viewer is listening
    if (window.onNewTrafficLog && data.log) {
      window.onNewTrafficLog(data.log);
    }

    // Update mini ticker if present on homepage
    addMiniTickerRow(data.log);
  }

  function updateMetricElement(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function addMiniTickerRow(log) {
    const ticker = document.getElementById('miniTrafficTicker');
    if (!ticker || !log) return;

    const row = document.createElement('div');
    row.className = 'traffic-row';
    const methodClass = `badge-${log.method.toLowerCase()}`;
    const statusClass = log.statusCode >= 500 ? 'status-5xx' : (log.statusCode >= 400 ? 'status-4xx' : 'status-2xx');

    row.innerHTML = `
      <span class="badge-method ${methodClass}">${log.method}</span>
      <span class="badge-status ${statusClass}">${log.statusCode}</span>
      <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: var(--text-muted);">${log.path}</span>
      <span style="color: ${log.chaos?.applied ? 'var(--neon-red)' : 'var(--neon-green)'}; font-family: var(--font-mono); font-size: 0.75rem;">
        ${log.durationMs}ms ${log.chaos?.applied ? '⚡ CHAOS' : ''}
      </span>
    `;

    ticker.prepend(row);
    while (ticker.children.length > 8) {
      ticker.removeChild(ticker.lastChild);
    }
  }

  // --- Master Chaos Toggle ---
  function setupMasterChaosToggle() {
    const btn = document.getElementById('masterChaosToggle');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const nextState = !currentChaos.globalEnabled;
      try {
        const res = await fetch('/api/chaos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ globalEnabled: nextState })
        });
        const data = await res.json();
        if (data.success) {
          currentChaos = data.data;
          updateChaosMasterUI(nextState);
          showToast(nextState ? 'Chaos Master ARMED: Faults active' : 'Chaos Master DISARMED: Normal sandbox', nextState ? 'error' : 'success');
        }
      } catch (err) {
        showToast('Failed to toggle Chaos Master', 'error');
      }
    });
  }

  function updateChaosMasterUI(isArmed) {
    const btn = document.getElementById('masterChaosToggle');
    if (!btn) return;
    if (isArmed) {
      btn.classList.add('armed');
      btn.querySelector('.text').textContent = 'CHAOS: ARMED';
    } else {
      btn.classList.remove('armed');
      btn.querySelector('.text').textContent = 'CHAOS: SAFE';
    }
  }

  // --- Status & Bootstrap ---
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      currentChaos.globalEnabled = data.chaosMasterArmed;
      updateChaosMasterUI(data.chaosMasterArmed);

      updateMetricElement('activeEndpointsVal', data.activeEndpointsCount);
      updateMetricElement('totalRequestsVal', data.totalRequests);
      updateMetricElement('avgLatencyVal', `${data.avgLatencyMs}ms`);
      updateMetricElement('errorRateVal', `${data.errorRate}%`);
      if (data.live) {
        updateMetricElement('rpsVal', data.live.rps);
      }
    } catch (err) {
      console.warn('Initial status fetch failed:', err);
    }
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --- Playground Request Dispatcher (on index.html) ---
  async function sendPlaygroundRequest() {
    const method = document.getElementById('pgMethod')?.value || 'GET';
    const path = document.getElementById('pgPath')?.value || '/mock/v1/users';
    const bodyStr = document.getElementById('pgBody')?.value;
    const outputEl = document.getElementById('pgOutput');
    const statusEl = document.getElementById('pgStatus');
    const timeEl = document.getElementById('pgTime');
    const chaosEl = document.getElementById('pgChaos');

    if (!outputEl) return;

    outputEl.textContent = 'Sending request...';
    const start = performance.now();

    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (['POST', 'PUT', 'PATCH'].includes(method) && bodyStr?.trim()) {
        options.body = bodyStr;
      }

      const res = await fetch(path, options);
      const elapsed = Math.round(performance.now() - start);
      const text = await res.text();

      if (statusEl) {
        statusEl.textContent = `${res.status} ${res.statusText}`;
        statusEl.className = `badge-status ${res.status >= 500 ? 'status-5xx' : (res.status >= 400 ? 'status-4xx' : 'status-2xx')}`;
      }
      if (timeEl) timeEl.textContent = `${elapsed}ms`;
      if (chaosEl) {
        const chaosApplied = res.headers.get('X-Chaos-Applied') === 'true';
        chaosEl.textContent = chaosApplied ? '⚡ FAULT APPLIED' : 'NONE';
        chaosEl.style.color = chaosApplied ? 'var(--neon-red)' : 'var(--neon-green)';
      }

      try {
        const parsed = JSON.parse(text);
        outputEl.textContent = JSON.stringify(parsed, null, 2);
      } catch {
        outputEl.textContent = text;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'CONNECTION FAILED';
        statusEl.className = 'badge-status status-5xx';
      }
      outputEl.textContent = `Error: ${err.message}`;
    }
  }

  // Macro Insertion Helper for Code Editor
  function insertMacro(macroText, targetId = 'endpointBody') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    el.value = text.substring(0, start) + macroText + text.substring(end);
    el.selectionStart = el.selectionEnd = start + macroText.length;
    el.focus();
  }

  return {
    init,
    showToast,
    sendPlaygroundRequest,
    insertMacro,
    fetchStatus
  };
})();

document.addEventListener('DOMContentLoaded', ForgeApp.init);
