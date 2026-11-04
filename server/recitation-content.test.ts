import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase, RevisionConflict } from './database';
import { RECITATION_CONTENT_ID } from './recitation-content';
import { emptyDatabase } from '../src/domain/model';
import { enrollRecitations, gradeRecitation } from '../src/domain/recitation';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'inklex-recitation-')); paths.push(path); return path; };
const open = (path: string, importRecitation = true) => {
  const db = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false, importRecitation });
  handles.push(db); return db;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
describe('recitation database upgrade', () => {
  it('backs up existing content, imports once, persists scores across restart and respects full restores', async () => {
    const path = directory(), previous = open(path, false), before = previous.read(); previous.close();
    const db = open(path), snapshot = db.read();
    expect(snapshot.revision).toBe(before.revision + 1);
    expect({ ...snapshot.data, recitation: undefined }).toEqual({ ...before.data, recitation: undefined });
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith(`before-${RECITATION_CONTENT_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    const id = snapshot.data.recitation!.questions[0].id, now = new Date('2026-11-05T08:00:00Z');
    const data = await gradeRecitation(await enrollRecitations(snapshot.data, [id], now), id, 3, 'scheduled', [], now);
    const saved = db.write(data, snapshot.revision); db.close();
    const again = open(path); expect(again.read()).toEqual(saved);
    expect(() => again.write(data, snapshot.revision)).toThrow(RevisionConflict);
    const restored = again.write(emptyDatabase(), saved.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });
  it('rolls back when the pre-import backup cannot be written and safely retries', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    rmSync(join(path, 'backups'), { recursive: true, force: true }); writeFileSync(join(path, 'backups'), 'blocked');
    expect(() => open(path)).toThrow();
    const unchanged = open(path, false); expect(unchanged.read()).toEqual(before); unchanged.close();
    rmSync(join(path, 'backups'));
    const upgraded = open(path); expect(upgraded.read().data.recitation!.questions).toHaveLength(77);
  });
});
