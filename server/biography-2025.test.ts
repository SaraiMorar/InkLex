import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/biography-2025.json';
import { BIOGRAPHY_2025_ID, mergeBiography2025 } from './biography-2025';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { articleCollection, articleTranslationUnits, emptyDatabase, getWord, saveContext, sentenceAt, validateDatabase } from '../src/domain/model';
import { mergeLegacySnapshot } from '../src/domain/api';
import { exportText, mergeBackup, parseBackup } from '../src/domain/storage';
import { enroll, gradeContext } from '../src/domain/scheduler';

const paths: string[] = [], handles: FileDatabase[] = [];
const open = (path: string, importBiography2025 = true) => {
  const db = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false, importBiography2025, importBeikao2027: false });
  handles.push(db); return db;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('2025 second-mock extracurricular biographies', () => {
  it('preserves all supplied glosses, complete paragraph translations, notes and exact character positions', () => {
    const before = createSeed(), after = mergeBiography2025(before);
    expect(corpus.stats).toEqual({ articles: 16, glosses: 557, translations: 68 });
    expect(corpus.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(after.articles).toHaveLength(before.articles.length + 16);
    expect(after.contexts).toHaveLength(before.contexts.length + 557);
    for (const source of corpus.articles) {
      const article = after.articles.find(a => a.id === source.id)!;
      expect(articleCollection(article)).toBe('extracurricular');
      expect(article.body).toBe(source.body);
      expect(article.translations).toEqual(source.translations);
      expect(source.translations.map(t => t.translation).join('')).toBe(source.referenceTranslation.replaceAll('\n', ''));
      for (const row of source.glosses) {
        const context = after.contexts.find(c => c.id === `biography2025:context:${row.ref}`)!;
        expect(context.gloss).toBe(row.meaning);
        expect(context.verified).toBe(true);
        expect(getWord(after, context.senseId)).toBe(row.word);
        expect(article.body.slice(context.articleStart!, context.articleStart! + row.word.length)).toBe(row.word);
        expect(context.text.slice(context.start, context.start + row.word.length)).toBe(row.word);
      }
      for (const row of source.translations) {
        expect(article.body.slice(row.articleStart, row.articleStart + row.source.length)).toBe(row.source);
        expect(articleTranslationUnits(article)).toContainEqual({ articleStart: row.articleStart, source: row.source });
      }
      if (source.notes) expect(article.body.endsWith(source.notes)).toBe(true);
    }
    expect(after.articles.find(a => a.title === '冯婉贞传')!.body).toContain('树帜曰');
    expect(after.articles.find(a => a.title === '朱一桂传')!.body).not.toMatch(/[\uE000-\uF8FF]/);
    expect(after.contexts.slice(0, before.contexts.length)).toEqual(before.contexts);
    expect(after.articles.slice(0, before.articles.length)).toEqual(before.articles);
    expect(after.cards).toEqual(before.cards); expect(after.reviews).toEqual(before.reviews); expect(after.readings).toEqual(before.readings);
    expect(validateDatabase(after)).toEqual(after);
    expect(mergeBiography2025(after)).toEqual(after);
  });

  it('reuses a renamed text with different punctuation and retains personal annotations and translations', () => {
    const incoming = corpus.articles[0], first = incoming.glosses[0];
    const body = '前言。\n' + incoming.body.replaceAll('，', '；') + '\n后记。';
    const start = body.indexOf(first.word, '前言。\n'.length), sentence = sentenceAt(body, start);
    const before = createSeed();
    before.articles.push({ id: 'personal-biography', title: '我整理的李陵材料', author: '', era: '', body,
      summary: '个人笔记', sample: false, collection: 'extracurricular',
      translations: [{ id: 'personal-translation', articleStart: 4, source: incoming.translations[0].source.replaceAll('，', '；'), translation: '我核对的译文' }] });
    const personal = saveContext(before, { id: 'personal-context', word: first.word, meaning: '我核对的释义', note: '',
      text: sentence.text, start: sentence.start, source: '个人标注', articleId: 'personal-biography', articleStart: start, verified: true });
    const after = mergeBiography2025(personal);
    expect(after.articles).toHaveLength(personal.articles.length + 15);
    expect(after.articles.some(a => a.id === incoming.id)).toBe(false);
    const article = after.articles.find(a => a.id === 'personal-biography')!;
    expect(article.body).toBe(body); expect(article.summary).toBe('个人笔记');
    expect(article.translations!.find(t => t.id === 'personal-translation')!.translation).toBe('我核对的译文');
    expect(after.contexts.find(c => c.id === 'personal-context')).toEqual(personal.contexts.find(c => c.id === 'personal-context'));
    expect(after.contexts.some(c => c.id === `biography2025:context:${first.ref}`)).toBe(false);
    expect(mergeBiography2025(after)).toEqual(after);
  });

  it('supports shared-lexicon recall and keeps the materials through complete backups and legacy migration', async () => {
    const before = mergeBiography2025(createSeed()), now = new Date('2026-11-06T08:00:00Z');
    const context = before.contexts.find(c => c.id.startsWith('biography2025:context:'))!;
    const learned = await gradeContext(await enroll(before, [context.senseId], now), context.id, 1, 'scheduled', now);
    expect(Date.parse(learned.cards[context.senseId].dueAt) - now.getTime()).toBe(60000);
    expect(parseBackup(exportText(learned))).toEqual(learned);
    expect(mergeBackup(emptyDatabase(), learned)).toEqual(learned);
    const migrated = mergeLegacySnapshot({ data: before, revision: 1, serverId: 'biography2025', pristine: true }, createSeed());
    expect(migrated.articles.filter(a => a.id.startsWith('biography2025:'))).toHaveLength(16);
    expect(migrated.contexts.filter(c => c.id.startsWith('biography2025:'))).toHaveLength(557);
    expect(new Set(before.entries.map(e => e.word)).size).toBe(before.entries.length);
  });

  it('backs up and imports once without changing existing progress, and respects a later complete restore', async () => {
    const path = mkdtempSync(join(tmpdir(), 'inklex-biography2025-')); paths.push(path);
    const old = open(path, false), initial = old.read(), context = initial.data.contexts.find(c => c.verified)!;
    const now = new Date('2026-11-06T08:00:00Z');
    const learned = await gradeContext(await enroll(initial.data, [context.senseId], now), context.id, 3, 'scheduled', now);
    learned.settings.dailyNew = 4;
    const before = old.write(learned, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.articles.slice(0, before.data.articles.length)).toEqual(before.data.articles);
    expect(after.data.contexts.slice(0, before.data.contexts.length)).toEqual(before.data.contexts);
    expect(after.data.cards).toEqual(before.data.cards); expect(after.data.reviews).toEqual(before.data.reviews);
    expect(after.data.readings).toEqual(before.data.readings); expect(after.data.settings).toEqual(before.data.settings);
    const backup = readdirSync(join(path, 'backups')).find(n => n.startsWith(`before-${BIOGRAPHY_2025_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close(); expect(open(path).read()).toEqual(restored);
  });
});
