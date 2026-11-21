import { forgeDb } from '../db/forgeDb.js';
import { ruleEvaluator } from '../engine/ruleEvaluator.js';
import { chaosInjector } from '../engine/chaosInjector.js';
import { trafficLogger } from '../engine/trafficLogger.js';

class MockController {
  /**
   * Handles incoming /mock/* requests.
   */
  async handleMock(req, res, parsedUrl, bodyBuffer) {
    const startTime = Date.now();

    // 1. Normalize mock path (strip leading /mock)
    let mockPath = parsedUrl.pathname.replace(/^\/mock/, '') || '/';
    if (!mockPath.startsWith('/')) mockPath = '/' + mockPath;

    const method = req.method.toUpperCase();
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

    // Parse body if present
    const rawBody = bodyBuffer ? bodyBuffer.toString('utf-8') : '';
    let parsedBody = null;
    if (rawBody.trim()) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    // 2. Locate matching mock endpoint
    const allEndpoints = forgeDb.getEndpoints();
    let matchedEndpoint = null;
    let routeParams = {};

    for (const ep of allEndpoints) {
      const matchResult = ruleEvaluator.matchEndpoint(ep, method, mockPath);
      if (matchResult) {
        matchedEndpoint = ep;
        routeParams = matchResult.params || {};
        break;
      }
    }

    // Build rich request context for templating
    const reqContext = {
      params: routeParams,
      query,
      headers: req.headers,
      body: parsedBody,
      ip: clientIp,
      method,
      path: mockPath
    };

    // 3. Evaluate Chaos Scenarios
    const chaosConfig = forgeDb.getChaosSettings();
    const chaosPlan = await chaosInjector.evaluate({
      ip: clientIp,
      path: mockPath,
      method,
      headers: req.headers
    }, chaosConfig);

    // Calculate latency (baseline delay + chaos jitter)
    const baseDelay = matchedEndpoint ? (matchedEndpoint.delayMs || 0) : 0;
    const totalDelay = baseDelay + chaosPlan.delayMs;

    if (totalDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }

    let finalStatusCode = 200;
    let finalHeaders = {
      'Content-Type': 'application/json',
      'X-PolyglotForge': 'Mock-Sandbox-Active',
      'X-Chaos-Applied': chaosPlan.applied ? 'true' : 'false'
    };
    let finalBody = '';

    // If rate limit dropout or error spike occurred
    if (chaosPlan.errorInjected) {
      finalStatusCode = chaosPlan.statusCode || 500;
      finalHeaders = { ...finalHeaders, ...chaosPlan.headers };
      finalBody = chaosPlan.customBody;
    } else if (matchedEndpoint) {
      // Normal mock response with template evaluation
      const evaluated = ruleEvaluator.evaluate(matchedEndpoint, reqContext);
      finalStatusCode = evaluated.statusCode;
      finalHeaders = { ...finalHeaders, ...evaluated.headers };
      finalBody = evaluated.body;

      if (chaosPlan.malformedJson) {
        finalBody = chaosInjector.corruptPayload(finalBody, chaosConfig.malformedJson.mode);
      }
    } else {
      // No endpoint matched -> 404 with helpful developer diagnostics
      finalStatusCode = 404;
      finalBody = JSON.stringify({
        status: "error",
        code: "MOCK_NOT_FOUND",
        message: `No active mock endpoint matches [${method}] /mock${mockPath}`,
        availableEndpoints: allEndpoints.filter(e => e.enabled).map(e => `${e.method} /mock${e.path}`),
        hint: "Configure a new route at http://localhost:3000/endpoints",
        timestamp: new Date().toISOString()
      }, null, 2);
    }

    const durationMs = Date.now() - startTime;
    finalHeaders['X-Response-Time-Ms'] = String(durationMs);

    // 4. Record in Traffic Logger
    trafficLogger.log({
      method,
      path: parsedUrl.pathname + parsedUrl.search,
      endpointMatched: matchedEndpoint ? matchedEndpoint.name : null,
      clientIp,
      requestHeaders: req.headers,
      requestBody: parsedBody || rawBody || null,
      statusCode: finalStatusCode,
      responseHeaders: finalHeaders,
      responseBody: finalBody,
      durationMs,
      sizeBytes: Buffer.byteLength(finalBody, 'utf-8'),
      chaos: {
        applied: chaosPlan.applied,
        actions: chaosPlan.actions
      }
    });

    // 5. Send HTTP Response (handle optional bandwidth throttle)
    if (chaosPlan.throttleKbps && finalBody.length > 256) {
      res.writeHead(finalStatusCode, finalHeaders);
      const chunkSize = Math.max(64, Math.floor((chaosPlan.throttleKbps * 1024) / 8 / 10)); // 10 chunks per second
      let offset = 0;

      const sendChunk = () => {
        if (offset < finalBody.length) {
          const chunk = finalBody.slice(offset, offset + chunkSize);
          res.write(chunk);
          offset += chunkSize;
          setTimeout(sendChunk, 100);
        } else {
          res.end();
        }
      };
      sendChunk();
    } else {
      res.writeHead(finalStatusCode, finalHeaders);
      res.end(finalBody);
    }
  }
}

export const mockController = new MockController();
