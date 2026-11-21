import os from 'node:os';
import { forgeDb } from '../db/forgeDb.js';
import { trafficLogger } from '../engine/trafficLogger.js';
import { mockController } from './mockController.js';

class AdminController {
  getStatus(req, res) {
    const stats = forgeDb.getStats();
    const live = trafficLogger.getLiveMetrics();

    const payload = {
      name: "PolyglotForge API Simulator & Chaos Workbench",
      version: "1.0.0",
      status: "ONLINE",
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      systemCpus: os.cpus().length,
      ...stats,
      live
    };

    this.sendJson(res, 200, payload);
  }

  // --- Endpoints ---
  listEndpoints(req, res) {
    const endpoints = forgeDb.getEndpoints();
    this.sendJson(res, 200, { success: true, count: endpoints.length, data: endpoints });
  }

  getEndpoint(req, res, id) {
    const ep = forgeDb.getEndpointById(id);
    if (!ep) {
      return this.sendJson(res, 404, { success: false, error: "Endpoint not found" });
    }
    this.sendJson(res, 200, { success: true, data: ep });
  }

  createEndpoint(req, res, body) {
    if (!body || !body.path) {
      return this.sendJson(res, 400, { success: false, error: "Missing required parameter 'path'" });
    }
    const created = forgeDb.createEndpoint(body);
    this.sendJson(res, 201, { success: true, message: "Endpoint created successfully", data: created });
  }

  updateEndpoint(req, res, id, body) {
    if (!body) {
      return this.sendJson(res, 400, { success: false, error: "Missing payload" });
    }
    const updated = forgeDb.updateEndpoint(id, body);
    if (!updated) {
      return this.sendJson(res, 404, { success: false, error: "Endpoint not found" });
    }
    this.sendJson(res, 200, { success: true, message: "Endpoint updated successfully", data: updated });
  }

  deleteEndpoint(req, res, id) {
    const deleted = forgeDb.deleteEndpoint(id);
    if (!deleted) {
      return this.sendJson(res, 404, { success: false, error: "Endpoint not found" });
    }
    this.sendJson(res, 200, { success: true, message: "Endpoint removed successfully" });
  }

  toggleEndpoint(req, res, id) {
    const ep = forgeDb.toggleEndpoint(id);
    if (!ep) {
      return this.sendJson(res, 404, { success: false, error: "Endpoint not found" });
    }
    this.sendJson(res, 200, { success: true, message: `Endpoint ${ep.enabled ? 'enabled' : 'disabled'}`, data: ep });
  }

  // --- Chaos Workbench ---
  getChaos(req, res) {
    const chaos = forgeDb.getChaosSettings();
    this.sendJson(res, 200, { success: true, data: chaos });
  }

  updateChaos(req, res, body) {
    if (!body) {
      return this.sendJson(res, 400, { success: false, error: "Missing chaos settings payload" });
    }
    const updated = forgeDb.updateChaosSettings(body);
    // Broadcast chaos state update to live clients
    trafficLogger.broadcast('chaos_updated', {
      chaos: updated,
      timestamp: new Date().toISOString()
    });
    this.sendJson(res, 200, { success: true, message: "Chaos matrix updated", data: updated });
  }

  resetChaos(req, res) {
    const reset = forgeDb.resetChaosSettings();
    trafficLogger.broadcast('chaos_updated', {
      chaos: reset,
      timestamp: new Date().toISOString()
    });
    this.sendJson(res, 200, { success: true, message: "Chaos scenarios disarmed and reset", data: reset });
  }

  // --- Traffic Inspection ---
  getTraffic(req, res, query) {
    const limit = Math.min(500, parseInt(query.limit, 10) || 100);
    const filter = {
      method: query.method,
      statusGroup: query.statusGroup,
      chaosOnly: query.chaosOnly === 'true'
    };
    const logs = trafficLogger.getLogs(limit, filter);
    this.sendJson(res, 200, { success: true, count: logs.length, data: logs });
  }

  clearTraffic(req, res) {
    trafficLogger.clearLogs();
    this.sendJson(res, 200, { success: true, message: "Traffic history cleared" });
  }

  async replayTraffic(req, res, id) {
    const log = trafficLogger.getLogById(id);
    if (!log) {
      return this.sendJson(res, 404, { success: false, error: "Traffic log entry not found" });
    }

    // Synthesize mock execution internally
    const urlObj = new URL(`http://localhost:3000${log.path}`);
    const simulatedReq = {
      method: log.method,
      headers: log.requestHeaders || {},
      socket: { remoteAddress: '127.0.0.1' }
    };

    let simulatedStatus = 200;
    let simulatedHeaders = {};
    let simulatedBody = '';

    const fakeRes = {
      writeHead(status, headers) {
        simulatedStatus = status;
        simulatedHeaders = headers || {};
      },
      write(chunk) {
        simulatedBody += chunk;
      },
      end(chunk) {
        if (chunk) simulatedBody += chunk;
      }
    };

    const bodyBuffer = log.requestBody
      ? Buffer.from(typeof log.requestBody === 'object' ? JSON.stringify(log.requestBody) : String(log.requestBody))
      : null;

    try {
      await mockController.handleMock(simulatedReq, fakeRes, urlObj, bodyBuffer);
      this.sendJson(res, 200, {
        success: true,
        message: "Request successfully replayed through simulator",
        replayed: {
          originalId: id,
          statusCode: simulatedStatus,
          headers: simulatedHeaders,
          body: simulatedBody
        }
      });
    } catch (err) {
      this.sendJson(res, 500, { success: false, error: `Replay failed: ${err.message}` });
    }
  }

  exportTraffic(req, res) {
    const logs = trafficLogger.getLogs(500);
    const exportData = {
      generator: "PolyglotForge Traffic Exporter",
      exportedAt: new Date().toISOString(),
      totalEntries: logs.length,
      entries: logs
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="forge-traffic-${Date.now()}.json"`
    });
    res.end(JSON.stringify(exportData, null, 2));
  }

  resetDefaults(req, res) {
    forgeDb.resetToDefaults();
    trafficLogger.clearLogs();
    this.sendJson(res, 200, { success: true, message: "System reset to factory sample endpoints & chaos configurations" });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data, null, 2));
  }
}

export const adminController = new AdminController();
