import crypto from 'node:crypto';

class ChaosInjector {
  constructor() {
    // In-memory sliding window rate limiter: Map<key, timestamp[]>
    this.rateLimitBuckets = new Map();
    // Periodic cleanup of stale rate limit buckets every 60 seconds
    setInterval(() => this.cleanupRateLimits(), 60000).unref();
  }

  cleanupRateLimits() {
    const now = Date.now();
    for (const [key, timestamps] of this.rateLimitBuckets.entries()) {
      const valid = timestamps.filter(t => now - t < 60000);
      if (valid.length === 0) {
        this.rateLimitBuckets.delete(key);
      } else {
        this.rateLimitBuckets.set(key, valid);
      }
    }
  }

  /**
   * Main injection logic called before mock response is generated.
   *
   * @param {object} req - Normalized request object (path, method, ip, headers)
   * @param {object} chaosConfig - Chaos configuration from forgeDb
   * @returns {object} Chaos execution plan and mutations
   */
  async evaluate(req, chaosConfig) {
    const result = {
      applied: false,
      actions: [],
      delayMs: 0,
      errorInjected: false,
      statusCode: null,
      headers: {},
      customBody: null,
      malformedJson: false,
      throttleKbps: null
    };

    if (!chaosConfig || !chaosConfig.globalEnabled) {
      return result;
    }

    // 1. FAULT: Rate Limiting Dropouts
    if (chaosConfig.rateLimiting && chaosConfig.rateLimiting.enabled) {
      const clientKey = `${req.ip || '127.0.0.1'}:${req.path || '/'}`;
      const now = Date.now();
      const windowMs = (chaosConfig.rateLimiting.windowSec || 10) * 1000;
      const maxReqs = chaosConfig.rateLimiting.maxRequests || 5;

      let timestamps = this.rateLimitBuckets.get(clientKey) || [];
      timestamps = timestamps.filter(t => now - t <= windowMs);
      timestamps.push(now);
      this.rateLimitBuckets.set(clientKey, timestamps);

      if (timestamps.length > maxReqs) {
        const retryAfter = Math.ceil((windowMs - (now - timestamps[0])) / 1000) || 1;
        result.applied = true;
        result.actions.push(`RATE_LIMIT_DROPOUT (${timestamps.length}/${maxReqs} reqs)`);
        result.errorInjected = true;
        result.statusCode = chaosConfig.rateLimiting.statusCode || 429;
        result.headers['Retry-After'] = String(retryAfter);
        result.headers['X-RateLimit-Limit'] = String(maxReqs);
        result.headers['X-RateLimit-Remaining'] = '0';
        result.headers['X-RateLimit-Reset'] = String(Math.floor((now + (retryAfter * 1000)) / 1000));
        result.customBody = JSON.stringify({
          error: "Too Many Requests",
          code: "CHAOS_RATE_LIMIT_DROPOUT",
          message: `Fault Injection: Request volume exceeded threshold of ${maxReqs} requests per ${chaosConfig.rateLimiting.windowSec}s`,
          retryAfterSeconds: retryAfter,
          injectedBy: "PolyglotForge Chaos Workbench"
        }, null, 2);

        return result; // Immediate dropout
      } else {
        result.headers['X-RateLimit-Limit'] = String(maxReqs);
        result.headers['X-RateLimit-Remaining'] = String(Math.max(0, maxReqs - timestamps.length));
      }
    }

    // 2. FAULT: Latency Jitter
    if (chaosConfig.latencyJitter && chaosConfig.latencyJitter.enabled) {
      const rate = chaosConfig.latencyJitter.jitterRate !== undefined ? chaosConfig.latencyJitter.jitterRate : 0.4;
      if (Math.random() < rate) {
        const min = chaosConfig.latencyJitter.minLatency || 50;
        const max = chaosConfig.latencyJitter.maxLatency || 3000;
        const jitter = Math.floor(Math.random() * (max - min + 1)) + min;

        result.applied = true;
        result.delayMs = jitter;
        result.actions.push(`LATENCY_JITTER (+${jitter}ms)`);
      }
    }

    // 3. FAULT: Error Spikes (random 500, 502, 503, 504)
    if (chaosConfig.errorSpikes && chaosConfig.errorSpikes.enabled) {
      const errorRate = chaosConfig.errorSpikes.errorRate !== undefined ? chaosConfig.errorSpikes.errorRate : 0.25;
      if (Math.random() < errorRate) {
        const codes = chaosConfig.errorSpikes.errorCodes && chaosConfig.errorSpikes.errorCodes.length > 0
          ? chaosConfig.errorSpikes.errorCodes
          : [500, 502, 503, 504];

        const pickedCode = codes[Math.floor(Math.random() * codes.length)];
        result.applied = true;
        result.errorInjected = true;
        result.statusCode = pickedCode;
        result.actions.push(`ERROR_SPIKE (HTTP ${pickedCode})`);

        if (chaosConfig.errorSpikes.customPayload && chaosConfig.errorSpikes.customPayload.trim()) {
          result.customBody = chaosConfig.errorSpikes.customPayload;
        } else {
          result.customBody = JSON.stringify({
            status: "error",
            code: `CHAOS_HTTP_${pickedCode}`,
            statusCode: pickedCode,
            error: this.getHttpErrorName(pickedCode),
            message: `Fault Injection Spike: Upstream simulated service failure (${this.getHttpErrorName(pickedCode)})`,
            faultEngine: "PolyglotForge Chaos Workbench",
            incidentId: `inc-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: new Date().toISOString()
          }, null, 2);
        }
      }
    }

    // 4. FAULT: Malformed JSON Payloads
    if (!result.errorInjected && chaosConfig.malformedJson && chaosConfig.malformedJson.enabled) {
      const malformedRate = chaosConfig.malformedJson.malformedRate !== undefined ? chaosConfig.malformedJson.malformedRate : 0.2;
      if (Math.random() < malformedRate) {
        result.applied = true;
        result.malformedJson = true;
        result.actions.push("MALFORMED_JSON_MUTATION");
      }
    }

    // 5. FAULT: Bandwidth Throttling
    if (chaosConfig.bandwidthThrottle && chaosConfig.bandwidthThrottle.enabled) {
      result.applied = true;
      result.throttleKbps = chaosConfig.bandwidthThrottle.kbps || 64;
      result.actions.push(`THROTTLE_BANDWIDTH (${result.throttleKbps} kbps)`);
    }

    return result;
  }

  /**
   * Applies payload mutation to corrupt JSON syntax.
   */
  corruptPayload(rawBody, mode = 'truncated') {
    if (!rawBody || typeof rawBody !== 'string') return "{ corrupted: true, unclosed: ";

    switch (mode) {
      case 'truncated': {
        const cutoff = Math.max(12, Math.floor(rawBody.length * 0.55));
        return rawBody.substring(0, cutoff) + "\n/* CHAOS_ENGINE: Payload truncated abruptly */";
      }
      case 'unexpected_char': {
        const mid = Math.floor(rawBody.length / 2);
        return rawBody.slice(0, mid) + " <<<SYNTAX_FAULT_TOKEN: unexpected byte>>> " + rawBody.slice(mid);
      }
      case 'null_mutation': {
        return rawBody.replace(/"[a-zA-Z0-9_-]+"\s*:/g, 'null:');
      }
      default:
        return rawBody.substring(0, Math.floor(rawBody.length / 2));
    }
  }

  getHttpErrorName(code) {
    const map = {
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout"
    };
    return map[code] || "Service Fault";
  }
}

export const chaosInjector = new ChaosInjector();
