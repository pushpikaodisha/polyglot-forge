// Real-Time Waterfall Traffic Inspection Panel
const TrafficViewer = (() => {
  let trafficLogs = [];
  let selectedLogId = null;
  let isPaused = false;
  let activeFilter = {
    method: '',
    statusGroup: '',
    chaosOnly: false,
    search: ''
  };

  function init() {
    setupControls();
    loadTrafficLogs();

    // Hook into global SSE traffic receiver
    window.onNewTrafficLog = (log) => {
      if (!isPaused) {
        trafficLogs.unshift(log);
        if (trafficLogs.length > 500) trafficLogs.pop();
        renderLogList();
        if (!selectedLogId) {
          selectLog(log.id);
        }
      }
    };
  }

  function setupControls() {
    // Filter buttons & inputs
    const searchInput = document.getElementById('trafficSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        activeFilter.search = e.target.value.toLowerCase().trim();
        renderLogList();
      });
    }

    const methodFilter = document.getElementById('methodFilter');
    if (methodFilter) {
      methodFilter.addEventListener('change', (e) => {
        activeFilter.method = e.target.value;
        renderLogList();
      });
    }

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        activeFilter.statusGroup = e.target.value;
        renderLogList();
      });
    }

    const chaosCheck = document.getElementById('chaosOnlyCheck');
    if (chaosCheck) {
      chaosCheck.addEventListener('change', (e) => {
        activeFilter.chaosOnly = e.target.checked;
        renderLogList();
      });
    }

    // Action buttons
    const pauseBtn = document.getElementById('pauseStreamBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        pauseBtn.textContent = isPaused ? '▶ Resume Feed' : '⏸ Pause Feed';
        pauseBtn.classList.toggle('btn-primary', isPaused);
        pauseBtn.classList.toggle('btn-secondary', !isPaused);
      });
    }

    const clearBtn = document.getElementById('clearTrafficBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Clear all captured traffic logs?')) return;
        try {
          await fetch('/api/traffic', { method: 'DELETE' });
          trafficLogs = [];
          selectedLogId = null;
          renderLogList();
          renderDetailPane(null);
          ForgeApp.showToast('Traffic logs cleared', 'info');
        } catch (err) {
          ForgeApp.showToast('Failed to clear traffic', 'error');
        }
      });
    }

    const exportBtn = document.getElementById('exportTrafficBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        window.location.href = '/api/traffic/export';
      });
    }

    const replayBtn = document.getElementById('replayReqBtn');
    if (replayBtn) {
      replayBtn.addEventListener('click', handleReplayRequest);
    }

    const copyCurlBtn = document.getElementById('copyCurlBtn');
    if (copyCurlBtn) {
      copyCurlBtn.addEventListener('click', handleCopyCurl);
    }
  }

  async function loadTrafficLogs() {
    try {
      const res = await fetch('/api/traffic?limit=100');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        trafficLogs = data.data;
        renderLogList();
        if (trafficLogs.length > 0) {
          selectLog(trafficLogs[0].id);
        } else {
          renderDetailPane(null);
        }
      }
    } catch (err) {
      console.error('Failed to load traffic history:', err);
    }
  }

  function getFilteredLogs() {
    return trafficLogs.filter(log => {
      if (activeFilter.method && log.method !== activeFilter.method) return false;
      if (activeFilter.statusGroup) {
        if (activeFilter.statusGroup === '2xx' && (log.statusCode < 200 || log.statusCode >= 300)) return false;
        if (activeFilter.statusGroup === '4xx' && (log.statusCode < 400 || log.statusCode >= 500)) return false;
        if (activeFilter.statusGroup === '5xx' && log.statusCode < 500) return false;
      }
      if (activeFilter.chaosOnly && (!log.chaos || !log.chaos.applied)) return false;
      if (activeFilter.search) {
        const query = activeFilter.search;
        const inPath = log.path?.toLowerCase().includes(query);
        const inEp = log.endpointMatched?.toLowerCase().includes(query);
        if (!inPath && !inEp) return false;
      }
      return true;
    });
  }

  function renderLogList() {
    const listEl = document.getElementById('trafficList');
    const countEl = document.getElementById('trafficCount');
    if (!listEl) return;

    const filtered = getFilteredLogs();
    if (countEl) countEl.textContent = `${filtered.length} entries`;

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 3rem 1.5rem; text-align: center; color: var(--text-dim);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📡</div>
          <div>No traffic recorded yet.</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">Make an API call to <code>/mock/v1/users</code> to view live packets.</div>
        </div>
      `;
      return;
    }

    // Find max latency for visual waterfall normalization
    const maxLatency = Math.max(100, ...filtered.map(l => l.durationMs || 0));

    let html = '';
    filtered.forEach(log => {
      const isSelected = log.id === selectedLogId;
      const methodClass = `badge-${log.method.toLowerCase()}`;
      const statusClass = log.statusCode >= 500 ? 'status-5xx' : (log.statusCode >= 400 ? 'status-4xx' : 'status-2xx');
      const timeStr = new Date(log.timestamp).toLocaleTimeString();
      const hasChaos = log.chaos && log.chaos.applied;

      // Waterfall width (percentage of max)
      const barWidth = Math.max(4, Math.round(((log.durationMs || 1) / maxLatency) * 100));

      html += `
        <div class="traffic-row ${isSelected ? 'selected' : ''}" onclick="TrafficViewer.selectLog('${log.id}')">
          <span class="badge-method ${methodClass}">${log.method}</span>
          <span class="badge-status ${statusClass}">${log.statusCode}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: #fff;">
              ${log.path}
            </div>
            <div style="font-size: 0.7rem; color: var(--text-dim); display: flex; gap: 0.5rem;">
              <span>${timeStr}</span>
              ${log.endpointMatched ? `<span>• ${log.endpointMatched}</span>` : ''}
              ${hasChaos ? `<span style="color: var(--neon-red); font-weight: bold;">⚡ ${log.chaos.actions[0] || 'CHAOS'}</span>` : ''}
            </div>
          </div>
          <div style="width: 70px; text-align: right;">
            <div style="font-size: 0.75rem; color: ${hasChaos ? 'var(--neon-amber)' : 'var(--neon-cyan)'};">${log.durationMs}ms</div>
            <div class="waterfall-bar-container">
              <div class="waterfall-bar ${hasChaos ? 'has-chaos' : ''}" style="width: ${barWidth}%;"></div>
            </div>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  function selectLog(id) {
    selectedLogId = id;
    const log = trafficLogs.find(l => l.id === id);
    renderLogList();
    renderDetailPane(log);
  }

  function renderDetailPane(log) {
    const pane = document.getElementById('trafficDetail');
    if (!pane) return;

    if (!log) {
      pane.innerHTML = `
        <div style="padding: 4rem 2rem; text-align: center; color: var(--text-dim);">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔍</div>
          <div style="font-size: 1.1rem; color: var(--text-muted); font-weight: 600;">Request Inspector</div>
          <div>Select an incoming request from the waterfall to inspect headers, timing breakdown, and payloads.</div>
        </div>
      `;
      return;
    }

    const hasChaos = log.chaos && log.chaos.applied;
    const reqBodyFormatted = log.requestBody
      ? (typeof log.requestBody === 'object' ? JSON.stringify(log.requestBody, null, 2) : String(log.requestBody))
      : '(No request payload)';

    let resBodyFormatted = '(Empty response body)';
    if (log.responseBody) {
      try {
        const parsed = JSON.parse(log.responseBody);
        resBodyFormatted = JSON.stringify(parsed, null, 2);
      } catch {
        resBodyFormatted = log.responseBody;
      }
    }

    pane.innerHTML = `
      <div style="padding: 1.25rem; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.2);">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="badge-method badge-${log.method.toLowerCase()}">${log.method}</span>
            <span class="badge-status ${log.statusCode >= 500 ? 'status-5xx' : (log.statusCode >= 400 ? 'status-4xx' : 'status-2xx')}">
              ${log.statusCode}
            </span>
            <span style="font-family: var(--font-mono); font-weight: 600; color: #fff;">${log.path}</span>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-secondary btn-sm" id="copyCurlBtn" onclick="TrafficViewer.handleCopyCurl()">
              📋 Copy cURL
            </button>
            <button class="btn btn-primary btn-sm" id="replayReqBtn" onclick="TrafficViewer.handleReplayRequest('${log.id}')">
              🔁 Replay Call
            </button>
          </div>
        </div>

        <div style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 1rem;">
          <span>IP: <code>${log.clientIp}</code></span>
          <span>Timestamp: <code>${new Date(log.timestamp).toISOString()}</code></span>
          <span>Duration: <code style="color: var(--neon-cyan);">${log.durationMs}ms</code></span>
          <span>Size: <code>${log.sizeBytes} bytes</code></span>
          ${log.endpointMatched ? `<span>Mock Rule: <code style="color: var(--neon-green);">${log.endpointMatched}</code></span>` : ''}
        </div>

        ${hasChaos ? `
          <div style="margin-top: 0.75rem; padding: 0.65rem 0.85rem; background: rgba(255, 45, 85, 0.1); border: 1px solid rgba(255, 45, 85, 0.3); border-radius: var(--radius-md);">
            <div style="color: var(--neon-red); font-weight: bold; font-size: 0.8rem; margin-bottom: 0.25rem;">
              ⚡ CHAOS INJECTION APPLIED
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #fff;">
              ${log.chaos.actions.map(a => `<div>• ${a}</div>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Tab Navigator -->
      <div style="display: flex; border-bottom: 1px solid var(--border-color); background: rgba(255,255,255,0.02);">
        <button class="nav-link active" onclick="TrafficViewer.switchTab('resBodyTab', this)">Response Payload</button>
        <button class="nav-link" onclick="TrafficViewer.switchTab('reqBodyTab', this)">Request Payload</button>
        <button class="nav-link" onclick="TrafficViewer.switchTab('headersTab', this)">Headers</button>
        <button class="nav-link" onclick="TrafficViewer.switchTab('timingTab', this)">Timing Breakdown</button>
      </div>

      <!-- Tab Content Area -->
      <div style="padding: 1rem; overflow-y: auto; flex: 1;">
        <!-- Response Body Tab -->
        <div id="resBodyTab" class="tab-pane">
          <div class="code-box">
            <pre><code>${escapeHtml(resBodyFormatted)}</code></pre>
          </div>
        </div>

        <!-- Request Body Tab -->
        <div id="reqBodyTab" class="tab-pane" style="display: none;">
          <div class="code-box">
            <pre><code>${escapeHtml(reqBodyFormatted)}</code></pre>
          </div>
        </div>

        <!-- Headers Tab -->
        <div id="headersTab" class="tab-pane" style="display: none;">
          <div style="margin-bottom: 1rem;">
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--neon-cyan); margin-bottom: 0.4rem;">Response Headers</div>
            <div class="code-box">
              <pre><code>${escapeHtml(JSON.stringify(log.responseHeaders || {}, null, 2))}</code></pre>
            </div>
          </div>
          <div>
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--neon-cyan); margin-bottom: 0.4rem;">Request Headers</div>
            <div class="code-box">
              <pre><code>${escapeHtml(JSON.stringify(log.requestHeaders || {}, null, 2))}</code></pre>
            </div>
          </div>
        </div>

        <!-- Timing Breakdown Tab -->
        <div id="timingTab" class="tab-pane" style="display: none;">
          <div class="card p-4">
            <div style="font-size: 0.95rem; font-weight: 600; color: #fff; margin-bottom: 0.75rem;">Latency Breakdown</div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; font-family: var(--font-mono); font-size: 0.85rem;">
              <div style="display: flex; justify-content: space-between;">
                <span>Total Elapsed:</span>
                <span style="color: var(--neon-cyan); font-weight: bold;">${log.durationMs}ms</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Chaos Delay Injected:</span>
                <span style="color: var(--neon-amber);">${hasChaos ? (log.chaos.actions.find(a => a.includes('JITTER')) || '0ms') : '0ms'}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Payload Size:</span>
                <span>${log.sizeBytes} bytes</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function switchTab(tabId, btn) {
    const container = document.getElementById('trafficDetail');
    if (!container) return;

    container.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
    container.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(tabId);
    if (target) target.style.display = 'block';
    if (btn) btn.classList.add('active');
  }

  async function handleReplayRequest(id) {
    if (!id) id = selectedLogId;
    if (!id) return;

    ForgeApp.showToast('Replaying request through simulator...', 'info');
    try {
      const res = await fetch(`/api/traffic/${id}/replay`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        ForgeApp.showToast(`Request replayed: HTTP ${data.replayed.statusCode}`, 'success');
      } else {
        ForgeApp.showToast(`Replay error: ${data.error}`, 'error');
      }
    } catch (err) {
      ForgeApp.showToast('Replay request failed', 'error');
    }
  }

  function handleCopyCurl() {
    const log = trafficLogs.find(l => l.id === selectedLogId);
    if (!log) return;

    const host = window.location.origin;
    let cmd = `curl -X ${log.method} "${host}${log.path}"`;

    if (log.requestHeaders) {
      for (const [k, v] of Object.entries(log.requestHeaders)) {
        if (!['host', 'content-length', 'connection'].includes(k.toLowerCase())) {
          cmd += ` \\\n  -H "${k}: ${v}"`;
        }
      }
    }

    if (log.requestBody && ['POST', 'PUT', 'PATCH'].includes(log.method)) {
      const body = typeof log.requestBody === 'object' ? JSON.stringify(log.requestBody) : String(log.requestBody);
      cmd += ` \\\n  -d '${body.replace(/'/g, "\\'")}'`;
    }

    navigator.clipboard.writeText(cmd).then(() => {
      ForgeApp.showToast('cURL command copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy cURL command:', cmd);
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return {
    init,
    selectLog,
    switchTab,
    handleReplayRequest,
    handleCopyCurl
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('trafficList')) {
    TrafficViewer.init();
  }
});
