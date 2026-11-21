import crypto from 'node:crypto';

// High-fidelity dictionaries for realistic mock data generation
const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Morgan", "Sam", "Chris", "Pat", "Riley", "Casey", "Avery",
  "Elena", "Marcus", "Sophia", "Liam", "Hiroshi", "Maya", "Lucas", "Zara", "Gabriel", "Chloe"
];

const LAST_NAMES = [
  "Vance", "Chen", "Sterling", "Kowalski", "Nakamura", "Alvarez", "Dubois", "Smith", "Zhang",
  "Patel", "Johansson", "O'Connor", "Novak", "Takahashi", "Moreau", "Reyes", "Fischer", "Kim"
];

const COMPANIES = [
  "Nexus Systems", "CyberDyne Dynamics", "Aether Cloud", "OmniCorp Labs", "Hyperion Analytics",
  "Vortex Security", "Synapse AI", "Starlight Networks", "Helios Logistics", "Quantex Bio"
];

const CITIES = [
  "San Francisco", "Tokyo", "Berlin", "London", "Austin", "Zurich", "Singapore", "Stockholm", "Toronto", "Seoul"
];

const COUNTRIES = [
  "United States", "Japan", "Germany", "United Kingdom", "Switzerland", "Singapore", "Sweden", "Canada", "South Korea"
];

const STATUSES = ["active", "pending", "completed", "verified", "suspended", "processing"];

const LOREM_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
  "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim",
  "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi"
];

class RuleEvaluator {
  /**
   * Evaluates incoming request path and method against configured endpoint patterns.
   * Supports exact paths, route params like `/v1/users/:id`, and wildcards `/v1/files/*`.
   */
  matchEndpoint(endpoint, method, path) {
    if (!endpoint.enabled) return null;

    // Check HTTP Method
    const epMethod = (endpoint.method || 'GET').toUpperCase();
    const reqMethod = (method || 'GET').toUpperCase();
    if (epMethod !== '*' && epMethod !== 'ALL' && epMethod !== reqMethod) {
      return null;
    }

    const cleanEpPath = this.normalizePath(endpoint.path);
    const cleanReqPath = this.normalizePath(path);

    // Exact match
    if (cleanEpPath === cleanReqPath) {
      return { matched: true, params: {} };
    }

    // Parameterized matching (:param)
    const epSegments = cleanEpPath.split('/').filter(Boolean);
    const reqSegments = cleanReqPath.split('/').filter(Boolean);

    // Handle wildcard endpoint ending in *
    if (cleanEpPath.endsWith('/*')) {
      const baseEp = cleanEpPath.slice(0, -2);
      if (cleanReqPath === baseEp || cleanReqPath.startsWith(baseEp + '/')) {
        return { matched: true, params: { wildcard: cleanReqPath.replace(baseEp, '') } };
      }
    }

    if (epSegments.length !== reqSegments.length) {
      return null;
    }

    const params = {};
    for (let i = 0; i < epSegments.length; i++) {
      const epSeg = epSegments[i];
      const reqSeg = reqSegments[i];

      if (epSeg.startsWith(':')) {
        const paramName = epSeg.slice(1);
        params[paramName] = decodeURIComponent(reqSeg);
      } else if (epSeg !== reqSeg) {
        return null;
      }
    }

    return { matched: true, params };
  }

  normalizePath(p) {
    if (!p) return '/';
    let norm = p.trim();
    if (!norm.startsWith('/')) norm = '/' + norm;
    if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    return norm;
  }

  /**
   * Processes response template and substitutes dynamic macros and request values.
   */
  evaluate(endpoint, reqContext = {}) {
    const rawBody = endpoint.body || '';
    const templatedBody = this.renderTemplate(rawBody, reqContext);

    // Parse and render custom headers
    const templatedHeaders = {};
    if (endpoint.headers && typeof endpoint.headers === 'object') {
      for (const [key, val] of Object.entries(endpoint.headers)) {
        templatedHeaders[key] = typeof val === 'string' ? this.renderTemplate(val, reqContext) : String(val);
      }
    }

    return {
      statusCode: endpoint.statusCode || 200,
      headers: templatedHeaders,
      body: templatedBody,
      delayMs: endpoint.delayMs || 0
    };
  }

  /**
   * Replaces macros like {{uuid}}, {{name}}, {{req.params.id}}, {{#repeat 3}}...{{/repeat}}
   */
  renderTemplate(template, context = {}) {
    if (typeof template !== 'string') return template;

    // 1. Process array repeat blocks: {{#repeat N}} ... {{/repeat}}
    let rendered = template.replace(/\{\{#repeat\s+(\d+)\}\}([\s\S]*?)\{\{\/repeat\}\}/g, (_, countStr, innerBlock) => {
      const count = Math.min(50, Math.max(1, parseInt(countStr, 10) || 1));
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push(innerBlock.trim());
      }
      return items.join(',\n');
    });

    // 2. Process function macros: {{randomInt(min, max)}}, {{randomChoice(a, b, c)}}
    rendered = rendered.replace(/\{\{randomInt\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\}\}/g, (_, min, max) => {
      const low = parseInt(min, 10);
      const high = parseInt(max, 10);
      return Math.floor(Math.random() * (high - low + 1)) + low;
    });

    rendered = rendered.replace(/\{\{randomFloat\(\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*(\d+)\s*)?\)\}\}/g, (_, min, max, dec) => {
      const low = parseFloat(min);
      const high = parseFloat(max);
      const precision = dec !== undefined ? parseInt(dec, 10) : 2;
      return (Math.random() * (high - low) + low).toFixed(precision);
    });

    rendered = rendered.replace(/\{\{randomChoice\(([^)]+)\)\}\}/g, (_, choicesStr) => {
      const choices = choicesStr.split(',').map(c => c.trim().replace(/^['"]|['"]$/g, ''));
      return choices[Math.floor(Math.random() * choices.length)] || '';
    });

    rendered = rendered.replace(/\{\{lorem\(\s*(\d+)\s*\)\}\}/g, (_, countStr) => {
      const count = parseInt(countStr, 10) || 5;
      const words = [];
      for (let i = 0; i < count; i++) {
        words.push(LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)]);
      }
      return words.join(' ');
    });

    // 3. Process context variables (req.params, req.query, req.body, req.headers)
    rendered = rendered.replace(/\{\{req\.([a-zA-Z0-9_.]+)(?:\s*\|\|\s*['"]?([^}'"]+)['"]?)?\}\}/g, (_, pathKey, fallback) => {
      const val = this.getDeepValue(context, pathKey);
      if (val !== undefined && val !== null) {
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
      return fallback !== undefined ? fallback : '';
    });

    // 4. Process built-in faker-like generator tokens
    rendered = rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, token) => {
      switch (token) {
        case 'uuid':
          return crypto.randomUUID();
        case 'id':
          return crypto.randomBytes(4).toString('hex');
        case 'timestamp':
          return new Date().toISOString();
        case 'unixTime':
          return Math.floor(Date.now() / 1000);
        case 'name':
        case 'fullName': {
          const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
          const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
          return `${fn} ${ln}`;
        }
        case 'firstName':
          return FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
        case 'lastName':
          return LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
        case 'email': {
          const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)].toLowerCase();
          const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)].toLowerCase();
          return `${fn}.${ln}@example.com`;
        }
        case 'company':
          return COMPANIES[Math.floor(Math.random() * COMPANIES.length)];
        case 'status':
          return STATUSES[Math.floor(Math.random() * STATUSES.length)];
        case 'city':
          return CITIES[Math.floor(Math.random() * CITIES.length)];
        case 'country':
          return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
        case 'boolean':
          return Math.random() > 0.5 ? 'true' : 'false';
        case 'ip':
          return `${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}`;
        case 'avatar': {
          const seed = crypto.randomBytes(3).toString('hex');
          return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
        }
        default:
          return match;
      }
    });

    return rendered;
  }

  getDeepValue(obj, pathStr) {
    if (!obj || !pathStr) return undefined;
    const parts = pathStr.split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr === null || curr === undefined || typeof curr !== 'object') {
        return undefined;
      }
      curr = curr[part];
    }
    return curr;
  }
}

export const ruleEvaluator = new RuleEvaluator();
