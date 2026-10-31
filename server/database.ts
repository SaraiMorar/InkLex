import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateDatabase, type Database } from '../src/domain/model.ts';
import { createSeed } from '../src/domain/seed.ts';
import { CONTENT_ID, mergeBundledContent } from './content.ts';

export interface Snapshot { data: Database; revision: number; serverId: string; pristine?: boolean; warning?: string }
export class RevisionConflict extends Error {
  constructor() { super('资料已被另一窗口或设备更新，请重试。'); }
}
type Row = { payload: string; revision: number; server_id: string };

export class FileDatabase {
  readonly path: string;
  private db: DatabaseSync;
  constructor(directory: string, options: { importBundledContent?: boolean } = {}) {
    mkdirSync(directory, { recursive: true });
    this.path = resolve(directory, 'inklex.sqlite');
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
      this.db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL, server_id TEXT NOT NULL);');
      this.db.exec('CREATE TABLE IF NOT EXISTS content_imports (id TEXT PRIMARY KEY, base_revision INTEGER NOT NULL);');
      if (!this.db.prepare('SELECT id FROM workspace WHERE id = 1').get()) {
        this.db.prepare('INSERT OR IGNORE INTO workspace(id, payload, revision, server_id) VALUES(1, ?, 0, ?)')
          .run(JSON.stringify(createSeed()), randomUUID());
      }
      this.read();
      if (options.importBundledContent !== false) this.installContent();
    } catch (error) { this.db.close(); throw error; }
  }
  read(): Snapshot {
    const row = this.db.prepare('SELECT payload, revision, server_id FROM workspace WHERE id = 1').get() as Row;
    const imported = this.db.prepare('SELECT base_revision FROM content_imports WHERE id = ?').get(CONTENT_ID) as { base_revision: number } | undefined;
    return { data: validateDatabase(JSON.parse(row.payload)), revision: row.revision, serverId: row.server_id,
      pristine: row.revision === 0 || (imported?.base_revision === 0 && row.revision === 1) };
  }
  private installContent() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT id FROM content_imports WHERE id = ?').get(CONTENT_ID)) {
        const current = this.read();
        const next = mergeBundledContent(current.data);
        const directory = join(dirname(this.path), 'backups');
        mkdirSync(directory, { recursive: true });
        // Never overwrite a prior snapshot. Failure leaves both payload and import marker untouched.
        writeFileSync(join(directory, `before-${CONTENT_ID}-${randomUUID()}.json`), JSON.stringify(current.data, null, 2),
          { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
        this.db.prepare('UPDATE workspace SET payload = ?, revision = revision + 1 WHERE id = 1').run(JSON.stringify(next));
        this.db.prepare('INSERT INTO content_imports(id, base_revision) VALUES(?, ?)').run(CONTENT_ID, current.revision);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  write(data: unknown, expectedRevision: number): Snapshot {
    const validated = validateDatabase(data);
    this.db.exec('BEGIN IMMEDIATE');
    let saved: Snapshot;
    try {
      const current = this.read();
      if (current.revision !== expectedRevision) throw new RevisionConflict();
      this.db.prepare('UPDATE workspace SET payload = ?, revision = revision + 1 WHERE id = 1').run(JSON.stringify(validated));
      this.db.exec('COMMIT');
      saved = { data: validated, revision: current.revision + 1, serverId: current.serverId, pristine: false };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    try { this.backup(saved.data); }
    catch { saved.warning = '资料已写入数据库，但自动备份暂未完成。请检查服务所在磁盘的可用空间。'; }
    return saved;
  }
  private backup(data: Database) {
    const directory = join(dirname(this.path), 'backups');
    mkdirSync(directory, { recursive: true });
    const target = join(directory, `inklex-${new Date().toISOString().slice(0, 10)}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flush: true });
      renameSync(temporary, target);
    } catch (error) { try { unlinkSync(temporary); } catch { /* no partial file */ } throw error; }
    const files = readdirSync(directory).filter(name => /^inklex-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    for (const old of files.slice(0, -30)) unlinkSync(join(directory, old));
  }
  close() { this.db.close(); }
}
