import http from 'http';
import { Actor } from 'apify';

const PORT = parseInt(process.env.ACTOR_WEB_SERVER_PORT ?? '4321', 10);

let server = null;
let serverReady = null;
let html = buildWaitingPage();

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPage({ title, body, note = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 560px; width: 100%; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    p  { color: #666; margin-bottom: 1.5rem; }
    pre { background: #f7f7f7; border-radius: 8px; overflow: auto; padding: 1rem; text-align: left;
          white-space: pre-wrap; }
    a.btn { display: inline-block; background: #0a6b50; color: white; padding: 0.75rem 1.5rem;
            border-radius: 8px; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #085c44; }
    .note { margin-top: 1.5rem; font-size: 0.85rem; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    ${body}
    ${note ? `<p class="note">${note}</p>` : ''}
  </div>
</body>
</html>`;
}

function buildWaitingPage() {
  return buildPage({
    title: 'Notion + YouTube Agent',
    body: `
      <h1>Notion + YouTube Agent</h1>
      <p>The actor is starting. If authorization is required, this view will update with the connection button.</p>
    `,
  });
}

function buildAuthPage(link, serviceName) {
  return buildPage({
    title: `Authorize ${serviceName}`,
    body: `
      <h1>🔐 Connect ${serviceName}</h1>
      <p>Click below to authorize access to your ${serviceName} account.<br/>
         The actor will continue automatically once you complete authorization.</p>
      <a class="btn" href="${escapeHtml(link)}" target="_blank" rel="noopener">Authorize ${serviceName} →</a>
    `,
    note: 'This page will update once authorization is complete.',
  });
}

function buildDonePage(serviceName) {
  return buildPage({
    title: `${serviceName} Authorized`,
    body: `
      <h1>✅ ${serviceName} Authorized</h1>
      <p>Returning to task — you can close this tab.</p>
    `,
  });
}

function buildFinalPage(result) {
  return buildPage({
    title: 'Task Complete',
    body: `
      <h1>Task Complete</h1>
      <p>The agent finished successfully. Results are available in the dataset output.</p>
      <pre>${escapeHtml(result)}</pre>
    `,
  });
}

function buildErrorPage(message) {
  return buildPage({
    title: 'Actor Failed',
    body: `
      <h1>Actor Failed</h1>
      <p>The actor stopped before completing the task.</p>
      <pre>${escapeHtml(message)}</pre>
    `,
  });
}

async function ensureServer() {
  if (serverReady) return serverReady;

  server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  });

  serverReady = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return serverReady;
}

export function getLiveViewUrl() {
  const { actorId, actorRunId } = Actor.getEnv();
  if (!actorId || !actorRunId) return `http://localhost:${PORT}`;
  return `https://${actorId}--${actorRunId}-${PORT}.runs.apify.net`;
}

export async function startAuthServer() {
  html = buildWaitingPage();
  await ensureServer();

  return {
    liveViewUrl: getLiveViewUrl(),
    close: closeAuthServer,
  };
}

export async function serveAuthPage(link, serviceName) {
  html = buildAuthPage(link, serviceName);
  await ensureServer();

  return {
    liveViewUrl: getLiveViewUrl(),
    markDone: () => { html = buildDonePage(serviceName); },
    close: closeAuthServer,
  };
}

export async function showFinalPage(result) {
  html = buildFinalPage(result);
  await ensureServer();
}

export async function showErrorPage(message) {
  html = buildErrorPage(message);
  await ensureServer();
}

export function closeAuthServer() {
  server?.close();
  server = null;
  serverReady = null;
}
