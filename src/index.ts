import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import authRoutes from './routes/auth';
import orgRoutes from './routes/organizations';
import scanRoutes from './routes/scans';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ─────────────────────────────────────────────────────────

app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin ?? '*', // tighten for production
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Org-Id'],
    credentials: true,
    maxAge: 86400,
  })
);

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (c) =>
  c.json({ status: 'ok', ts: new Date().toISOString() })
);

// ── API routes ────────────────────────────────────────────────────────────────

app.route('/api/auth', authRoutes);
app.route('/api/orgs', orgRoutes);

// Scan / count routes live under /api/orgs/:orgId — share the scan router
app.route('/api/orgs', scanRoutes);

// ── SPA fallback (serve index.html for all non-API routes) ───────────────────
// Cloudflare Pages handles static file serving automatically.
// This fallback is only needed when running as a pure Worker.

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (!url.pathname.startsWith('/api/')) {
    // In Worker + Sites mode the binding is __STATIC_CONTENT
    // Pages handles this automatically; for Worker-only deploys we 404
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width,initial-scale=1">
       <title>Doorman</title>
       <script>window.__INITIAL_PATH__="${url.pathname}"</script>
       </head><body><div id="root"></div>
       <script type="module" src="/assets/index.js"></script>
       </body></html>`
    );
  }
  return c.json({ error: 'Not found' }, 404);
});

export default app;
