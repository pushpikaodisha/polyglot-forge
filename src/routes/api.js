import { adminController } from '../controllers/adminController.js';
import { trafficLogger } from '../engine/trafficLogger.js';

export async function handleApiRoute(req, res, parsedUrl, bodyBuffer) {
  const method = req.method.toUpperCase();
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams.entries());

  let parsedBody = null;
  if (bodyBuffer && bodyBuffer.length > 0) {
    try {
      parsedBody = JSON.parse(bodyBuffer.toString('utf-8'));
    } catch {
      parsedBody = bodyBuffer.toString('utf-8');
    }
  }

  // --- Real-Time SSE Stream ---
  if (pathname === '/api/traffic/stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    trafficLogger.addClient(res);
    return;
  }

  // --- Status & Diagnostics ---
  if (pathname === '/api/status' && method === 'GET') {
    return adminController.getStatus(req, res);
  }

  if (pathname === '/api/reset-defaults' && method === 'POST') {
    return adminController.resetDefaults(req, res);
  }

  // --- Endpoints Collection ---
  if (pathname === '/api/endpoints' && method === 'GET') {
    return adminController.listEndpoints(req, res);
  }

  if (pathname === '/api/endpoints' && method === 'POST') {
    return adminController.createEndpoint(req, res, parsedBody);
  }

  // Matches /api/endpoints/:id/toggle
  const toggleMatch = pathname.match(/^\/api\/endpoints\/([^/]+)\/toggle$/);
  if (toggleMatch && method === 'POST') {
    return adminController.toggleEndpoint(req, res, toggleMatch[1]);
  }

  // Matches /api/endpoints/:id
  const epMatch = pathname.match(/^\/api\/endpoints\/([^/]+)$/);
  if (epMatch) {
    const id = epMatch[1];
    if (method === 'GET') return adminController.getEndpoint(req, res, id);
    if (method === 'PUT') return adminController.updateEndpoint(req, res, id, parsedBody);
    if (method === 'DELETE') return adminController.deleteEndpoint(req, res, id);
  }

  // --- Chaos Controls ---
  if (pathname === '/api/chaos' && method === 'GET') {
    return adminController.getChaos(req, res);
  }

  if (pathname === '/api/chaos' && method === 'POST') {
    return adminController.updateChaos(req, res, parsedBody);
  }

  if (pathname === '/api/chaos/reset' && method === 'POST') {
    return adminController.resetChaos(req, res);
  }

  // --- Traffic Inspection ---
  if (pathname === '/api/traffic' && method === 'GET') {
    return adminController.getTraffic(req, res, query);
  }

  if (pathname === '/api/traffic' && method === 'DELETE') {
    return adminController.clearTraffic(req, res);
  }

  if (pathname === '/api/traffic/export' && method === 'GET') {
    return adminController.exportTraffic(req, res);
  }

  // Matches /api/traffic/:id/replay
  const replayMatch = pathname.match(/^\/api\/traffic\/([^/]+)\/replay$/);
  if (replayMatch && method === 'POST') {
    return adminController.replayTraffic(req, res, replayMatch[1]);
  }

  // Not Found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: false,
    error: `API route not found: ${method} ${pathname}`
  }, null, 2));
}
