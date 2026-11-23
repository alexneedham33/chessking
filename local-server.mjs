// Local development server for Opening Lab.
// Serves the static chess app and forwards AI coaching to the same AWS API
// used by Amplify. No OpenAI API key is stored or required on this computer.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 8000);
const apiOrigin = process.env.OPENING_LAB_API_ORIGIN || 'https://puoot03589.execute-api.eu-west-2.amazonaws.com';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function coach(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) return json(res, 413, { error: 'Coaching request too large' });
    chunks.push(chunk);
  }
  try {
    const upstream = await fetch(`${apiOrigin}/api/coach/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(30000),
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    console.error('AI proxy error:', error.message);
    json(res, 502, { error: 'AI coach backend unavailable' });
  }
}

createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch { return json(res, 400, { error: 'Invalid URL' }); }

  if (url.pathname === '/api/coach/move') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    void coach(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });

  let relative;
  try { relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { return json(res, 400, { error: 'Invalid path' }); }
  const filePath = resolve(root, '.' + relative);
  if (filePath !== root && !filePath.startsWith(root + sep)) return json(res, 403, { error: 'Forbidden' });
  // Do not expose development credentials or repository internals.
  if (relative.split('/').some(part => part.startsWith('.') || part === 'node_modules') ||
      /\.(?:env|pem|key)$/i.test(relative)) return json(res, 404, { error: 'Not found' });
  try {
    const info = statSync(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: 'File not found' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Opening Lab local server: http://127.0.0.1:${port}/`);
  console.log('AI coaching requests are forwarded to AWS Lambda via API Gateway.');
});
