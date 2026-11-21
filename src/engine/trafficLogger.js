import { forgeDb } from '../db/forgeDb.js';

class TrafficLogger {
  constructor() {
    this.sseClients = new Set();
    this.rollingWindow = []; // array of timestamps for RPS calculation
    this.bufferCapacity = 500;
  }

  /**
   * Registers a new SSE HTTP response connection.
   */
  addClient(res) {
    this.sseClients.add(res);

    // Initial handshake ping
    this.sendSseEvent(res, 'connected', {
      message: 'PolyglotForge Traffic Stream connected',
      activeClients: this.sseClients.size,
      timestamp: new Date().toISOString()
    });

    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  removeClient(res) {
    this.sseClients.delete(res);
  }

  sendSseEvent(client, event, data) {
    try {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.sseClients.delete(client);
    }
  }

  broadcast(event, data) {
    for (const client of this.sseClients) {
      this.sendSseEvent(client, event, data);
    }
  }

  /**
   * Logs a completed request/response transaction.
   */
  log(record) {
    const now = Date.now();
    this.rollingWindow.push(now);
    // keep rolling window within last 10 seconds
    const cutoff = now - 10000;
    while (this.rollingWindow.length > 0 && this.rollingWindow[0] < cutoff) {
      this.rollingWindow.shift();
    }

    // Persist to ForgeDb
    const savedLog = forgeDb.addTrafficLog(record);

    // Broadcast to all live SSE watchers
    this.broadcast('traffic_event', {
      log: savedLog,
      metrics: this.getLiveMetrics()
    });

    return savedLog;
  }

  getLiveMetrics() {
    const now = Date.now();
    const cutoff = now - 10000;
    const recentCount = this.rollingWindow.filter(t => t >= cutoff).length;
    const rps = (recentCount / 10).toFixed(1);

    const stats = forgeDb.getStats();
    return {
      rps: parseFloat(rps),
      activeClients: this.sseClients.size,
      totalRequests: stats.totalRequests,
      chaosRequests: stats.chaosRequests,
      errorRate: stats.errorRate,
      avgLatencyMs: stats.avgLatencyMs,
      chaosMasterArmed: stats.chaosMasterArmed
    };
  }

  getLogs(limit = 100, filter = {}) {
    return forgeDb.getTrafficLogs(limit, filter);
  }

  clearLogs() {
    forgeDb.clearTrafficLogs();
    this.rollingWindow = [];
    this.broadcast('logs_cleared', { timestamp: new Date().toISOString() });
    return true;
  }

  getLogById(id) {
    return forgeDb.traffic.find(t => t.id === id) || null;
  }
}

export const trafficLogger = new TrafficLogger();
