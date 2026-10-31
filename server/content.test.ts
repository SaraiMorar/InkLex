import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDatabase, RevisionConflict } from './database';
import { contentStats, createBundledContent, mergeBundledContent } from './content';
import { contextsFor, emptyDatabase, getWord, saveArticle, saveContext, validateDatabase, type Database } from '../src/domain/model';
import { createSeed } from '../src/domain/seed';
import { enroll, gradeContext, studyQueue } from '../src/domain/scheduler';
import { mergeLegacySnapshot } from '../src/domain/api';

const paths: string[] = [];
const handles: FileDatabase[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), 'inklex-content-test-')); paths.push(path); return path; }
function open(path: string, importBundledContent = true) {
  const handle = new FileDatabase(path, { importBundledContent, importSupplement: false, importTextbookArticles: false }); handles.push(handle); return handle;
}
afterEach(() => {
  for (const handle of handles.splice(0)) { try { handle.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const row = (data: Database, ref: string) => data.contexts.find(c => c.id === `gaosan300:context:${ref}`)!;

describe('reviewed 300-word source material', () => {
  it('preserves every word and example, separate senses and source references without inventing progress', () => {
    const data = createBundledContent();
    expect(data.entries).toHaveLength(300); expect(data.senses).toHaveLength(1665); expect(data.contexts).toHaveLength(2295);
    expect(data.contexts.filter(c => !c.verified)).toHaveLength(contentStats.pending);
    expect(data.contexts.every(c => c.source.includes('高三300实词'))).toBe(true);
    expect(Object.keys(data.cards)).toHaveLength(0); expect(data.reviews).toHaveLength(0); expect(data.readings).toHaveLength(0);
    expect(data.contexts.every(c => !c.learned && c.articleId === null)).toBe(true);
    expect(validateDatabase(data)).toEqual(data);
    expect(createBundledContent()).toEqual(data);
  });
  it('joins across page breaks and keeps book titles inside example sentences', () => {
    const data = createBundledContent();
    expect(getWord(data, row(data, '2:1').senseId)).toBe('安');
    expect(row(data, '4:1').gloss).toBe('毁坏，败坏');
    expect(row(data, '80:1').gloss).toBe('劳动，劳作');
    expect(row(data, '57:29').gloss).toBe('常与“惟”、“唯”搭配，为宾语提前标志。');
    expect(row(data, '58:1')).toBeUndefined();
    expect(row(data, '49:25').text).toContain('吾于《武成》，取');
    expect(row(data, '73:16').text).toContain('《水经》云');
    expect(row(data, '45:26').text).toContain('命曰《琵琶行》');
    expect(row(data, '50:4').text).not.toContain('辛弃疾');
  });
  it('marks the correct repeated occurrence and excludes unresolved source errors from both study pools', async () => {
    const data = createBundledContent();
    for (const ref of ['14:19', '22:6', '53:18', '63:11']) {
      const context = row(data, ref), word = getWord(data, context.senseId);
      expect(context.start).toBe(context.text.lastIndexOf(word));
      expect(context.start).toBeGreaterThan(context.text.indexOf(word));
    }
    for (const ref of ['10:18', '59:8', '76:11', '80:11', '55:16']) {
      const context = row(data, ref);
      expect(context.verified).toBe(false);
      expect(contextsFor(data, context.senseId)).not.toContainEqual(context);
      expect(data.senses.find(s => s.id === context.senseId)?.note).toContain('待核对');
    }
    const pendingOnly = row(data, '59:8');
    const enrolled = await enroll(data, [pendingOnly.senseId]);
    expect(studyQueue(enrolled, new Date())).not.toContain(pendingOnly.senseId);
  });
});

describe('one-time content upgrade', () => {
  it('backs up and upgrades an existing database without changing personal content, history or settings', async () => {
    const path = directory(), old = open(path, false), initial = old.read();
    let data = saveContext(initial.data, { word: '测试', meaning: '自己的释义', text: '这是测试例句。', start: 2, note: '自己的笔记', source: '自录', articleId: null, articleStart: null, verified: true });
    const context = data.contexts[0], now = new Date('2026-10-31T01:00:00Z');
    data = await enroll(data, [context.senseId], now);
    data = await gradeContext(data, context.id, 1, 'scheduled', now);
    data.settings.dailyNew = 6;
    data = saveArticle(data, { ...data.articles[0], body: data.articles[0].body + '\n自录补充。' });
    const before = old.write(data, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.data.articles).toEqual(data.articles); expect(after.data.cards).toEqual(data.cards);
    expect(after.data.reviews).toEqual(data.reviews); expect(after.data.readings).toEqual(data.readings); expect(after.data.settings).toEqual(data.settings);
    expect(after.data.contexts.slice(0, data.contexts.length)).toEqual(data.contexts);
    expect(after.data.entries.filter(e => e.word === '可')).toHaveLength(1);
    expect(after.data.contexts.length - data.contexts.length).toBe(2295);
    expect(after.revision).toBe(before.revision + 1); expect(after.serverId).toBe(before.serverId); expect(after.pristine).toBe(false);
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith('before-gaosan-300-v1-'))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(data);
    expect(() => upgraded.write(data, before.revision)).toThrow(RevisionConflict);
    upgraded.close(); expect(open(path).read()).toEqual(after);
  });
  it('respects later edits and complete restores across process restarts', () => {
    const path = directory(), db = open(path), initial = db.read();
    expect(initial.pristine).toBe(true);
    const context = row(initial.data, '1:2');
    context.text = '我哀之。'; context.start = 1; context.source = '我的修订';
    const saved = db.write(initial.data, initial.revision); db.close();
    const again = open(path); expect(again.read().data).toEqual(saved.data); expect(again.read().pristine).toBe(false);
    const restored = again.write(emptyDatabase(), saved.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });
  it('rolls back a blocked pre-import backup and can retry without duplicates', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    writeFileSync(join(path, 'backups'), 'blocked');
    expect(() => open(path)).toThrow();
    const unchanged = open(path, false); expect(unchanged.read()).toEqual(before); unchanged.close();
    rmSync(join(path, 'backups'));
    const upgraded = open(path).read();
    expect(upgraded.revision).toBe(before.revision + 1);
    expect(upgraded.data.contexts).toHaveLength(before.data.contexts.length + 2295);
  });
  it('retains bundled examples when migrating edited legacy articles and settings to a pristine server', () => {
    let legacy = createSeed();
    legacy = saveArticle(legacy, { ...legacy.articles[0], body: '我编辑过的小石潭记原文。' });
    legacy.settings.dailyNew = 4;
    const snapshot = open(directory()).read();
    const merged = mergeLegacySnapshot(snapshot, legacy);
    expect(merged.articles).toEqual(legacy.articles); expect(merged.settings).toEqual(legacy.settings);
    expect(merged.contexts).toHaveLength(legacy.contexts.length + 2295);
    expect(merged.contexts.filter(c => !c.verified).length).toBeGreaterThanOrEqual(contentStats.pending);
    expect(validateDatabase(merged)).toEqual(merged);
    expect(mergeBundledContent(createSeed()).contexts).toHaveLength(2328);
  });
});
