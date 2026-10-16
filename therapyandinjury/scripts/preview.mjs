// Local preview of the production build: static files from dist/client, pages from dist/server.
//   npm run build && npm run preview      → http://localhost:4321
// Set TI_CONTENT_FILE=/path/to/content.json to preview edited content.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const { handler } = await import(join(root, 'server/entry.mjs'));
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain' };
http.createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(root, 'client', p);
  try {
    if (!p.endsWith('/') && statSync(f).isFile()) {
      res.setHeader('content-type', types[extname(f)] || 'application/octet-stream');
      return createReadStream(f).pipe(res);
    }
  } catch {}
  handler(req, res, () => { res.statusCode = 404; res.end('Not found'); });
}).listen(process.env.PORT || 4321, () => console.log(`Preview: http://localhost:${process.env.PORT || 4321}`));
