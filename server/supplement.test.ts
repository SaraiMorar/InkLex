import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/supplement.json';
import { mergeSupplement, SUPPLEMENT_ID } from './supplement';
import { mergeBundledContent } from './content';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { contextsFor, emptyDatabase, validateDatabase } from '../src/domain/model';
import { enroll, gradeContext } from '../src/domain/scheduler';
import { mergeLegacySnapshot } from '../src/domain/api';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const p = mkdtempSync(join(tmpdir(), 'inklex-supplement-')); paths.push(p); return p; };
const open = (path: string, importSupplement = true) => { const h = new FileDatabase(path, { importSupplement }); handles.push(h); return h; };
afterEach(() => {
  for (const h of handles.splice(0)) { try { h.close(); } catch { /* already closed */ } }
  for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true });
});
const source = (pack: string, ref: string) => corpus.records.find(r => r.pack === pack && r.ref === ref)!;

describe('three-source vocabulary supplement', () => {
  it('covers all source headwords, preserves ambiguous cases, and repairs mixed quotation layouts', () => {
    for (const pack of ['150实词', '18虚词'] as const) {
      const words = new Set(corpus.records.filter(r => r.pack === pack).map(r => r.word));
      expect(corpus.headings[pack].every(w => words.has(w))).toBe(true);
    }
    expect(corpus.headings['18虚词']).toHaveLength(18);
    expect(corpus.unresolved).toHaveLength(9);
    expect(source('150实词', '1376.1')).toMatchObject({ word: '幸', meaning: '幸而', text: '大王亦幸赦臣' });
    expect(source('150实词', '1376.2')).toMatchObject({ meaning: '幸而', text: '故幸来告良' });
    expect(source('150实词', '976')).toMatchObject({ meaning: '没有（谁），没有（什么）', text: '非刘豫州莫可以当曹操者' });
    expect(source('18虚词', '473.1').meaning).toContain('表示工具');
    expect(source('18虚词', '473.2').meaning).toContain('表示工具');
    expect(source('18虚词', '476.1').meaning).toContain('表示凭借');
    expect(source('高频实词', '164').issue).not.toBe('');
    for (const row of corpus.records) expect(row.text.slice(row.start, row.start + row.word.length)).toBe(row.word);
  });
  it('merges repeated examples, excludes pending examples from review, and invents no progress', () => {
    const before = mergeBundledContent(createSeed()), after = mergeSupplement(before);
    expect(after.entries).toHaveLength(390);
    expect(after.contexts.length - before.contexts.length).toBe(1575);
    expect(after.contexts.filter(c => c.id.startsWith('supplement:') && !c.verified)).toHaveLength(271);
    for (const c of after.contexts.filter(c => !c.verified)) expect(contextsFor(after, c.senseId)).not.toContainEqual(c);
    expect(after.contexts.slice(0, before.contexts.length)).toEqual(before.contexts);
    expect(after.cards).toEqual(before.cards); expect(after.reviews).toEqual(before.reviews);
    expect(after.readings).toEqual(before.readings); expect(after.articles).toEqual(before.articles);
    expect(mergeSupplement(after)).toEqual(after);
    expect(validateDatabase(after)).toEqual(after);
  });
  it('upgrades only the new pack, backs up edits and real review history, and does not reapply after restore', async () => {
    const p = directory(), old = open(p, false), snapshot = old.read();
    const c = snapshot.data.contexts.find(c => c.id.startsWith('gaosan300:') && c.verified)!;
    c.source = '我修订的出处';
    let data = await enroll(snapshot.data, [c.senseId], new Date('2026-10-31T01:00:00Z'));
    data = await gradeContext(data, c.id, 1, 'scheduled', new Date('2026-10-31T01:00:00Z'));
    data.settings.dailyNew = 3;
    const saved = old.write(data, snapshot.revision); old.close();
    const upgraded = open(p), after = upgraded.read();
    expect(after.revision).toBe(saved.revision + 1); expect(after.pristine).toBe(false);
    expect(after.data.contexts.find(x => x.id === c.id)).toEqual(data.contexts.find(x => x.id === c.id));
    expect(after.data.cards).toEqual(data.cards); expect(after.data.reviews).toEqual(data.reviews);
    expect(after.data.settings).toEqual(data.settings);
    const backup = readdirSync(join(p, 'backups')).find(f => f.startsWith(`before-${SUPPLEMENT_ID}-`))!;
    expect(JSON.parse(readFileSync(join(p, 'backups', backup), 'utf8'))).toEqual(data);
    upgraded.close(); const again = open(p); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close();
    expect(open(p).read()).toEqual(restored);
  });
  it('keeps both packs during first-time browser migration after two content upgrades', () => {
    const snapshot = open(directory()).read();
    expect(snapshot.revision).toBe(2); expect(snapshot.pristine).toBe(true);
    const legacy = createSeed(); legacy.settings.dailyNew = 7;
    const merged = mergeLegacySnapshot(snapshot, legacy);
    expect(merged.settings.dailyNew).toBe(7);
    expect(merged.contexts).toHaveLength(snapshot.data.contexts.length);
    expect(merged.contexts.some(c => c.id.startsWith('gaosan300:'))).toBe(true);
    expect(merged.contexts.some(c => c.id.startsWith('supplement:'))).toBe(true);
  });
});
