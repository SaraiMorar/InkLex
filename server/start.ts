import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { FileDatabase } from './database';
import { handleApi } from './http';

const root = resolve('dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('请先运行 npm run build 生成网页文件。');
const database = new FileDatabase(resolve(process.env.INKLEX_DATA_DIR || 'data'));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  if (await handleApi(req, res, database)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    const file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT || 5173), process.env.HOST || '127.0.0.1', () => {
  console.log(`InkLex 已启动，端口 ${process.env.PORT || 5173}；数据文件：${database.path}`);
});
const stop = () => { server.close(() => { database.close(); process.exit(0); }); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
