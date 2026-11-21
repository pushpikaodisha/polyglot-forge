import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRoute } from './src/routes/api.js';
import { mockController } from './src/controllers/mockController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const VIEWS_DIR = path.resolve(__dirname, 'views');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  // Global CORS headers for cross-origin workbench testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-PolyglotForge, X-Chaos-Applied, X-Response-Time-Ms, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Read request body buffer
  const chunks = [];
  req.on('data', chunk => {
    chunks.push(chunk);
  });

  req.on('end', async () => {
    const bodyBuffer = Buffer.concat(chunks);

    try {
      // 1. Mock Engine Sandbox Routing (/mock/*)
      if (pathname.startsWith('/mock')) {
        return await mockController.handleMock(req, res, parsedUrl, bodyBuffer);
      }

      // 2. Workbench API Routing (/api/*)
      if (pathname.startsWith('/api')) {
        return await handleApiRoute(req, res, parsedUrl, bodyBuffer);
      }

      // 3. HTML View Routing
      if (pathname === '/' || pathname === '/index.html') {
        return serveFile(res, path.join(VIEWS_DIR, 'index.html'));
      }
      if (pathname === '/endpoints' || pathname === '/endpoints.html') {
        return serveFile(res, path.join(VIEWS_DIR, 'endpoints.html'));
      }
      if (pathname === '/chaos' || pathname === '/chaos.html') {
        return serveFile(res, path.join(VIEWS_DIR, 'chaos.html'));
      }
      if (pathname === '/traffic' || pathname === '/traffic.html') {
        return serveFile(res, path.join(VIEWS_DIR, 'traffic.html'));
      }

      // 4. Static Asset Serving (public/*)
      let relativeStaticPath = pathname;
      if (relativeStaticPath.startsWith('/public/')) {
        relativeStaticPath = relativeStaticPath.replace('/public/', '/');
      }
      const safePath = path.normalize(relativeStaticPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC_DIR, safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return serveFile(res, filePath);
      }

      // 5. Fallback 404
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>404 Not Found - PolyglotForge</title>
          <link rel="stylesheet" href="/css/forge.css">
        </head>
        <body class="bg-dark text-slate p-8 text-center flex-center min-h-screen">
          <div class="card p-8 max-w-md mx-auto">
            <h1 class="text-3xl font-mono text-neon-red mb-2">404 // NOT FOUND</h1>
            <p class="text-muted mb-6">Route <code>${pathname}</code> is not a workbench page or registered mock.</p>
            <a href="/" class="btn btn-primary">Return to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('[PolyglotForge Server Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: "Internal Server Error",
        message: err.message
      }));
    }
  });
});

function serveFile(res, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error loading asset: ' + err.message);
  }
}

async function findAvailablePort(candidatePort = 3000) {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);

  const candidates = [candidatePort, 3300, 3100, 8080, 5000];
  for (const p of candidates) {
    const isTaken = await new Promise((resolve) => {
      const sock = net.createConnection({ host: 'localhost', port: p });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
    });
    if (!isTaken) return p;
  }
  return candidatePort;
}

async function start() {
  const chosenPort = await findAvailablePort(3000);

  server.listen(chosenPort, () => {
    console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   \x1b[1m\x1b[35m⚡ POLYGLOTFORGE API SIMULATOR & CHAOS WORKBENCH\x1b[0m\x1b[36m                   ║
║   \x1b[32mProduction-Ready Node.js 22 Engine Active\x1b[36m                          ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝\x1b[0m

  \x1b[32m● Status:\x1b[0m ONLINE (Zero External NPM Dependencies)
  \x1b[34m● Node.js:\x1b[0m ${process.version} (ESM Runtime)
  \x1b[35m● Base URL:\x1b[0m http://localhost:${chosenPort}

  \x1b[1mWorkbench Console Interfaces:\x1b[0m
  ➜  \x1b[36mDashboard:\x1b[0m           http://localhost:${chosenPort}/
  ➜  \x1b[36mEndpoint Designer:\x1b[0m   http://localhost:${chosenPort}/endpoints
  ➜  \x1b[36mChaos Matrix:\x1b[0m        http://localhost:${chosenPort}/chaos
  ➜  \x1b[36mTraffic Inspector:\x1b[0m   http://localhost:${chosenPort}/traffic

  \x1b[1mSample Mock Sandbox Endpoints:\x1b[0m
  ➜  GET   http://localhost:${chosenPort}/mock/v1/users
  ➜  GET   http://localhost:${chosenPort}/mock/v1/users/usr_4829
  ➜  POST  http://localhost:${chosenPort}/mock/v1/auth/login
  ➜  POST  http://localhost:${chosenPort}/mock/v1/orders
  ➜  GET   http://localhost:${chosenPort}/mock/v1/health

  \x1b[33mPress Ctrl+C to stop the workbench server\x1b[0m
`);
  });
}

start().catch(err => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});
