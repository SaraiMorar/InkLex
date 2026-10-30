import type { IncomingMessage, ServerResponse } from 'node:http';
import { FileDatabase, RevisionConflict } from './database.ts';

const MAX_BYTES = 15_000_000;
class HttpError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, '请使用 JSON 格式提交资料。');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size <= MAX_BYTES) chunks.push(Buffer.from(chunk)); }
  if (size > MAX_BYTES) throw new HttpError(413, '资料超过 15 MB，未保存此次更改。');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, '提交的 JSON 格式不正确。'); }
}
export async function handleApi(request: IncomingMessage, response: ServerResponse, database: FileDatabase): Promise<boolean> {
  const path = (request.url ?? '').split('?')[0];
  if (!path.startsWith('/api/')) return false;
  try {
    if (request.method === 'GET' && path === '/api/health') { json(response, 200, { status: 'ok', storage: 'sqlite' }); return true; }
    if (request.method === 'GET' && path === '/api/state') { json(response, 200, database.read()); return true; }
    if (request.method === 'GET' && path === '/api/backup') {
      response.setHeader('Content-Disposition', 'attachment; filename="inklex-backup.json"');
      json(response, 200, database.read().data); return true;
    }
    if (request.method === 'PUT' && path === '/api/state') {
      const origin = request.headers.origin;
      let sameOrigin = true;
      if (origin) { try { sameOrigin = new URL(origin).host === request.headers.host; } catch { sameOrigin = false; } }
      if (!sameOrigin || request.headers['sec-fetch-site'] === 'cross-site' || request.headers['x-inklex-client'] !== '1') throw new HttpError(403, '请从 InkLex 应用内保存资料。');
      const body = await readJson(request);
      if (!Number.isSafeInteger(body?.revision) || body.revision < 0 || !body.data) throw new HttpError(400, '提交的资料或版本号不完整。');
      json(response, 200, database.write(body.data, body.revision)); return true;
    }
    json(response, 404, { error: '没有这个接口。' });
  } catch (error) {
    if (error instanceof RevisionConflict) json(response, 409, { error: error.message });
    else if (error instanceof HttpError) json(response, error.status, { error: error.message });
    else if (error instanceof Error && error.name === 'ZodError') json(response, 400, { error: '资料格式校验未通过，现有数据已保留。' });
    else if (error instanceof Error && !('code' in error)) json(response, 400, { error: error.message });
    else json(response, 503, { error: '服务暂时无法读写数据库，请检查服务与磁盘状态。' });
  }
  return true;
}
