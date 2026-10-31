import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase, RevisionConflict } from './database';
import { enroll, gradeContext, studyQueue } from '../src/domain/scheduler';
import { parseBackup } from '../src/domain/storage';

const directories: string[] = [];
const handles: FileDatabase[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), 'inklex-sqlite-test-')); directories.push(path); return path; }
function open(path: string) { const db = new FileDatabase(path, { importBundledContent: false }); handles.push(db); return db; }
afterEach(() => { for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } } for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('SQLite persistence and recovery', () => {
  it('preserves real review state, identities and due tasks after closing and reopening the database', async () => {
    const path = directory(), first = open(path), initial = first.read();
    const now = new Date('2026-10-30T02:00:00Z'), context = initial.data.contexts[0];
    let data = await enroll(initial.data, [context.senseId], now);
    data = await gradeContext(data, context.id, 1, 'scheduled', now);
    first.write(data, initial.revision); first.close();
    const reopened = open(path), recovered = reopened.read();
    expect(readFileSync(reopened.path).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    expect(recovered.data).toEqual(data); expect(recovered.serverId).toBe(initial.serverId); expect(recovered.revision).toBe(1);
    expect(studyQueue(recovered.data, new Date(now.getTime() + 61000))).toEqual([context.senseId]);
  });
  it('rejects stale writes even from another connection and preserves the winning update', () => {
    const path = directory(), first = open(path), second = open(path);
    const a = first.read(), b = second.read(); a.data.settings.dailyNew = 7;
    first.write(a.data, a.revision); b.data.settings.dailyNew = 90;
    expect(() => second.write(b.data, b.revision)).toThrow(RevisionConflict);
    expect(second.read().data.settings.dailyNew).toBe(7);
    expect(first.read().revision).toBe(1);
  });
  it('rejects invalid data without advancing the version or mutating existing data', () => {
    const db = open(directory()), initial = db.read();
    expect(() => db.write({ ...initial.data, version: 99 }, initial.revision)).toThrow();
    expect(db.read()).toEqual(initial);
  });
  it('writes complete daily backups which can be restored using the existing import format', () => {
    const path = directory(), db = open(path), initial = db.read();
    initial.data.settings.retention = .95;
    const saved = db.write(initial.data, initial.revision);
    const files = readdirSync(join(path, 'backups'));
    expect(files).toHaveLength(1); expect(files[0]).toMatch(/^inklex-\d{4}-\d{2}-\d{2}\.json$/);
    expect(parseBackup(readFileSync(join(path, 'backups', files[0]), 'utf8'))).toEqual(saved.data);
  });
  it('reports a backup failure without misreporting or rolling back an already durable save', () => {
    const path = directory(), db = open(path), initial = db.read();
    writeFileSync(join(path, 'backups'), 'blocked');
    initial.data.settings.dailyNew = 6;
    const saved = db.write(initial.data, initial.revision);
    expect(saved.warning).toContain('已写入数据库');
    expect(db.read().data.settings.dailyNew).toBe(6);
    db.close(); expect(open(path).read().revision).toBe(1);
  });
});
