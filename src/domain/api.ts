import { type Database, validateDatabase } from './model';
import { mergeBackup, parseBackup, STORAGE_KEY } from './storage';
import { bundledContentFrom } from './bundles';

export interface Snapshot { data: Database; revision: number; serverId: string; pristine?: boolean; warning?: string }
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function request(method: 'GET' | 'PUT', body?: unknown, localData?: Database): Promise<Snapshot> {
  let response: Response;
  try {
    response = await fetch('/api/state', { method, cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'X-InkLex-Client': '1', ...(localData ? { 'X-InkLex-Return': 'minimal' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError(0, '无法连接学习服务。请确认服务正在运行，再重试。'); }
  let result;
  try { result = await response.json(); } catch { throw new ApiError(503, '学习服务返回了无效响应，请确认运行的是新版 InkLex。'); }
  if (!response.ok) throw new ApiError(response.status, result.error || '保存未完成，请重试。');
  if (!Number.isSafeInteger(result.revision) || typeof result.serverId !== 'string') throw new ApiError(503, '学习服务的数据版本不正确。');
  return { data: result.data === undefined && localData ? localData : validateDatabase(result.data), revision: result.revision, serverId: result.serverId, pristine: result.pristine === true, warning: result.warning };
}
export const readServer = () => request('GET');
export const writeServer = (data: Database, revision: number) => request('PUT', { data, revision }, data);

export async function transact(operation: (data: Database) => Database | Promise<Database>, initial?: Snapshot): Promise<Snapshot> {
  let snapshot = initial ?? await readServer();
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = await operation(snapshot.data);
    if (JSON.stringify(next) === JSON.stringify(snapshot.data)) return snapshot;
    try { return await writeServer(next, snapshot.revision); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || attempt === 3) throw error;
      snapshot = await readServer();
    }
  }
  throw new ApiError(409, '其他设备正在更新资料，请稍后再试。');
}
export function legacyFingerprint(raw: string) {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  return `${raw.length}-${hash >>> 0}`;
}
export function mergeLegacySnapshot(current: Snapshot, legacy: Database): Database {
  if (current.pristine) return mergeBackup(legacy, bundledContentFrom(current.data));
  return current.revision === 0 ? legacy : mergeBackup(current.data, legacy);
}
export async function migrateLegacy(snapshot: Snapshot): Promise<Snapshot> {
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return snapshot; }
  if (!raw) return snapshot;
  const marker = `inklex.migrated.${snapshot.serverId}`;
  const fingerprint = legacyFingerprint(raw);
  try { if (localStorage.getItem(marker) === fingerprint) return snapshot; } catch { /* server remains usable */ }
  const legacy = parseBackup(raw);
  let saved = snapshot;
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = attempt === 0 ? snapshot : await readServer();
    const next = mergeLegacySnapshot(current, legacy);
    try {
      saved = JSON.stringify(current.data) === JSON.stringify(next) ? current : await writeServer(next, current.revision);
      break;
    } catch (error) { if (!(error instanceof ApiError) || error.status !== 409 || attempt === 3) throw error; }
  }
  // Preserve the original browser copy. Mark migration only after durable server acknowledgment.
  try { localStorage.setItem(marker, fingerprint); } catch { /* merge stays idempotent on the next launch */ }
  return saved;
}
