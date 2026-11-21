import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'forge_db.json');

const DEFAULT_CHAOS = {
  globalEnabled: false,
  latencyJitter: {
    enabled: false,
    minLatency: 100,
    maxLatency: 2500,
    jitterRate: 0.4
  },
  errorSpikes: {
    enabled: false,
    errorRate: 0.25,
    errorCodes: [500, 502, 503, 504],
    customPayload: ""
  },
  malformedJson: {
    enabled: false,
    malformedRate: 0.15,
    mode: "truncated" // 'truncated', 'unexpected_char', 'null_mutation'
  },
  rateLimiting: {
    enabled: false,
    maxRequests: 5,
    windowSec: 10,
    statusCode: 429
  },
  bandwidthThrottle: {
    enabled: false,
    kbps: 64 // 64kbps simulation (slow 2G/3G)
  }
};

const DEFAULT_ENDPOINTS = [
  {
    id: "ep-users-list",
    name: "User Directory API",
    method: "GET",
    path: "/v1/users",
    statusCode: 200,
    delayMs: 0,
    enabled: true,
    tags: ["users", "crm"],
    description: "Returns paginated list of active platform users with dynamic mock data",
    headers: {
      "Content-Type": "application/json",
      "X-Total-Count": "100",
      "X-Page": "1"
    },
    body: JSON.stringify({
      status: "success",
      page: 1,
      total: 100,
      data: [
        {
          id: "{{uuid}}",
          name: "{{name}}",
          email: "{{email}}",
          company: "{{company}}",
          status: "active",
          createdAt: "{{timestamp}}"
        },
        {
          id: "{{uuid}}",
          name: "{{name}}",
          email: "{{email}}",
          company: "{{company}}",
          status: "active",
          createdAt: "{{timestamp}}"
        },
        {
          id: "{{uuid}}",
          name: "{{name}}",
          email: "{{email}}",
          company: "{{company}}",
          status: "pending",
          createdAt: "{{timestamp}}"
        }
      ]
    }, null, 2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "ep-user-detail",
    name: "Get User By ID",
    method: "GET",
    path: "/v1/users/:id",
    statusCode: 200,
    delayMs: 25,
    enabled: true,
    tags: ["users"],
    description: "Fetches individual user details reflecting the requested URL param ID",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: "success",
      user: {
        id: "{{req.params.id}}",
        name: "{{name}}",
        email: "{{email}}",
        role: "admin",
        avatar: "https://api.dicebear.com/7.x/bottts/svg?seed={{req.params.id}}",
        registeredAt: "{{timestamp}}"
      }
    }, null, 2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "ep-auth-login",
    name: "Authentication Login",
    method: "POST",
    path: "/v1/auth/login",
    statusCode: 200,
    delayMs: 50,
    enabled: true,
    tags: ["auth", "security"],
    description: "Simulates user authentication, issuing token and session credentials",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({
      token_type: "Bearer",
      access_token: "forge_jwt_{{uuid}}",
      expires_in: 3600,
      user: {
        username: "{{req.body.username || 'developer'}}",
        role: "superadmin",
        lastLogin: "{{timestamp}}"
      }
    }, null, 2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "ep-create-order",
    name: "Place Commerce Order",
    method: "POST",
    path: "/v1/orders",
    statusCode: 201,
    delayMs: 80,
    enabled: true,
    tags: ["ecommerce", "checkout"],
    description: "Accepts cart payload and creates verified order with transaction ID",
    headers: {
      "Content-Type": "application/json",
      "Location": "/mock/v1/orders/ord-{{uuid}}"
    },
    body: JSON.stringify({
      orderId: "ORD-{{randomInt(100000, 999999)}}",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      amount: "{{randomFloat(29.99, 499.99, 2)}}",
      currency: "USD",
      processedAt: "{{timestamp}}",
      trackingNumber: "TRK-{{uuid}}"
    }, null, 2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "ep-health-check",
    name: "System Health Probe",
    method: "GET",
    path: "/v1/health",
    statusCode: 200,
    delayMs: 0,
    enabled: true,
    tags: ["devops", "monitoring"],
    description: "Standard liveness and readiness probe response",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: "HEALTHY",
      uptimeSeconds: "{{unixTime}}",
      timestamp: "{{timestamp}}",
      services: {
        database: "UP",
        queue: "UP",
        cache: "UP"
      }
    }, null, 2),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

class ForgeDb {
  constructor() {
    this.endpoints = [];
    this.chaos = { ...DEFAULT_CHAOS };
    this.traffic = [];
    this.maxTrafficHistory = 500;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.endpoints = Array.isArray(parsed.endpoints) ? parsed.endpoints : DEFAULT_ENDPOINTS;
        this.chaos = parsed.chaos ? { ...DEFAULT_CHAOS, ...parsed.chaos } : { ...DEFAULT_CHAOS };
        this.traffic = Array.isArray(parsed.traffic) ? parsed.traffic.slice(0, this.maxTrafficHistory) : [];
      } else {
        this.endpoints = [...DEFAULT_ENDPOINTS];
        this.chaos = { ...DEFAULT_CHAOS };
        this.traffic = [];
        this.save();
      }
    } catch (err) {
      console.error('[ForgeDb] Warning: Failed to load DB file, initializing with defaults:', err.message);
      this.endpoints = [...DEFAULT_ENDPOINTS];
      this.chaos = { ...DEFAULT_CHAOS };
      this.traffic = [];
      this.save();
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        version: "1.0",
        lastSaved: new Date().toISOString(),
        endpoints: this.endpoints,
        chaos: this.chaos,
        traffic: this.traffic.slice(0, this.maxTrafficHistory)
      };

      const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      console.error('[ForgeDb] Failed to persist database:', err.message);
    }
  }

  // --- Endpoints CRUD ---
  getEndpoints() {
    return [...this.endpoints];
  }

  getEndpointById(id) {
    return this.endpoints.find(e => e.id === id) || null;
  }

  createEndpoint(data) {
    const id = data.id || `ep-${crypto.randomBytes(4).toString('hex')}`;
    let formattedPath = (data.path || '/').trim();
    if (!formattedPath.startsWith('/')) {
      formattedPath = '/' + formattedPath;
    }

    const newEndpoint = {
      id,
      name: data.name || 'Untitled Endpoint',
      method: (data.method || 'GET').toUpperCase(),
      path: formattedPath,
      statusCode: parseInt(data.statusCode, 10) || 200,
      delayMs: Math.max(0, parseInt(data.delayMs, 10) || 0),
      enabled: data.enabled !== false,
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(t => t.trim()) : []),
      description: data.description || '',
      headers: typeof data.headers === 'object' && data.headers !== null ? data.headers : { "Content-Type": "application/json" },
      body: typeof data.body === 'string' ? data.body : JSON.stringify(data.body || {}, null, 2),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.endpoints.unshift(newEndpoint);
    this.save();
    return newEndpoint;
  }

  updateEndpoint(id, data) {
    const idx = this.endpoints.findIndex(e => e.id === id);
    if (idx === -1) return null;

    let formattedPath = data.path !== undefined ? data.path.trim() : this.endpoints[idx].path;
    if (formattedPath && !formattedPath.startsWith('/')) {
      formattedPath = '/' + formattedPath;
    }

    const updated = {
      ...this.endpoints[idx],
      name: data.name !== undefined ? data.name : this.endpoints[idx].name,
      method: data.method !== undefined ? data.method.toUpperCase() : this.endpoints[idx].method,
      path: formattedPath,
      statusCode: data.statusCode !== undefined ? parseInt(data.statusCode, 10) : this.endpoints[idx].statusCode,
      delayMs: data.delayMs !== undefined ? Math.max(0, parseInt(data.delayMs, 10)) : this.endpoints[idx].delayMs,
      enabled: data.enabled !== undefined ? !!data.enabled : this.endpoints[idx].enabled,
      tags: data.tags !== undefined ? (Array.isArray(data.tags) ? data.tags : data.tags.split(',').map(t => t.trim())) : this.endpoints[idx].tags,
      description: data.description !== undefined ? data.description : this.endpoints[idx].description,
      headers: data.headers !== undefined ? data.headers : this.endpoints[idx].headers,
      body: data.body !== undefined ? (typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2)) : this.endpoints[idx].body,
      updatedAt: new Date().toISOString()
    };

    this.endpoints[idx] = updated;
    this.save();
    return updated;
  }

  deleteEndpoint(id) {
    const initialLen = this.endpoints.length;
    this.endpoints = this.endpoints.filter(e => e.id !== id);
    const deleted = this.endpoints.length < initialLen;
    if (deleted) this.save();
    return deleted;
  }

  toggleEndpoint(id) {
    const ep = this.endpoints.find(e => e.id === id);
    if (!ep) return null;
    ep.enabled = !ep.enabled;
    ep.updatedAt = new Date().toISOString();
    this.save();
    return ep;
  }

  // --- Chaos Settings ---
  getChaosSettings() {
    return { ...this.chaos };
  }

  updateChaosSettings(newSettings) {
    this.chaos = {
      ...this.chaos,
      ...newSettings,
      latencyJitter: {
        ...this.chaos.latencyJitter,
        ...(newSettings.latencyJitter || {})
      },
      errorSpikes: {
        ...this.chaos.errorSpikes,
        ...(newSettings.errorSpikes || {})
      },
      malformedJson: {
        ...this.chaos.malformedJson,
        ...(newSettings.malformedJson || {})
      },
      rateLimiting: {
        ...this.chaos.rateLimiting,
        ...(newSettings.rateLimiting || {})
      },
      bandwidthThrottle: {
        ...this.chaos.bandwidthThrottle,
        ...(newSettings.bandwidthThrottle || {})
      }
    };
    this.save();
    return this.chaos;
  }

  resetChaosSettings() {
    this.chaos = JSON.parse(JSON.stringify(DEFAULT_CHAOS));
    this.save();
    return this.chaos;
  }

  // --- Traffic History ---
  getTrafficLogs(limit = 100, filter = {}) {
    let result = [...this.traffic];
    if (filter.method) {
      result = result.filter(t => t.method === filter.method.toUpperCase());
    }
    if (filter.statusGroup) {
      if (filter.statusGroup === '2xx') result = result.filter(t => t.statusCode >= 200 && t.statusCode < 300);
      else if (filter.statusGroup === '4xx') result = result.filter(t => t.statusCode >= 400 && t.statusCode < 500);
      else if (filter.statusGroup === '5xx') result = result.filter(t => t.statusCode >= 500);
    }
    if (filter.chaosOnly) {
      result = result.filter(t => t.chaos && t.chaos.applied);
    }
    return result.slice(0, limit);
  }

  addTrafficLog(entry) {
    const log = {
      id: entry.id || `req-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      method: (entry.method || 'GET').toUpperCase(),
      path: entry.path || '/',
      endpointMatched: entry.endpointMatched || null,
      clientIp: entry.clientIp || '127.0.0.1',
      requestHeaders: entry.requestHeaders || {},
      requestBody: entry.requestBody || null,
      statusCode: entry.statusCode || 200,
      responseHeaders: entry.responseHeaders || {},
      responseBody: entry.responseBody || null,
      durationMs: entry.durationMs || 0,
      sizeBytes: entry.sizeBytes || 0,
      chaos: entry.chaos || { applied: false, actions: [] }
    };

    this.traffic.unshift(log);
    if (this.traffic.length > this.maxTrafficHistory) {
      this.traffic.length = this.maxTrafficHistory;
    }
    this.save();
    return log;
  }

  clearTrafficLogs() {
    this.traffic = [];
    this.save();
    return true;
  }

  getStats() {
    const totalRequests = this.traffic.length;
    const chaosRequests = this.traffic.filter(t => t.chaos && t.chaos.applied).length;
    const errorRequests = this.traffic.filter(t => t.statusCode >= 500).length;
    const avgLatency = totalRequests > 0
      ? Math.round(this.traffic.reduce((acc, cur) => acc + (cur.durationMs || 0), 0) / totalRequests)
      : 0;

    return {
      activeEndpointsCount: this.endpoints.filter(e => e.enabled).length,
      totalEndpointsCount: this.endpoints.length,
      totalRequests,
      chaosRequests,
      errorRequests,
      errorRate: totalRequests > 0 ? ((errorRequests / totalRequests) * 100).toFixed(1) : "0.0",
      avgLatencyMs: avgLatency,
      chaosMasterArmed: !!this.chaos.globalEnabled
    };
  }

  resetToDefaults() {
    this.endpoints = JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS));
    this.chaos = JSON.parse(JSON.stringify(DEFAULT_CHAOS));
    this.traffic = [];
    this.save();
    return true;
  }
}

export const forgeDb = new ForgeDb();
