import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/beikao-2027.json';
import { BEIKAO_2027_ID, mergeBeikao2027 } from './beikao-2027';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { articleCollection, articleTranslationUnits, emptyDatabase, getWord, saveContext, sentenceAt, validateDatabase } from '../src/domain/model';
import { mergeLegacySnapshot } from '../src/domain/api';
import { exportText, mergeBackup, parseBackup } from '../src/domain/storage';
import { enroll, gradeContext } from '../src/domain/scheduler';

const paths: string[] = [], handles: FileDatabase[] = [];
const open = (path: string, importBeikao2027 = true) => {
  const db = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false, importBiography2025: false, importBeikao2027 });
  handles.push(db); return db;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('2027 备考课外文言文', () => {
  it('preserves all supplied glosses, paragraph translations, notes and exact character positions', () => {
    const before = createSeed(), after = mergeBeikao2027(before);
    expect(corpus.stats).toEqual({ articles: 2, glosses: 338, translations: 8, lexiconExamples: 297, unresolved: 26 });
    expect(corpus.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(after.articles).toHaveLength(before.articles.length + 2);
    expect(after.contexts).toHaveLength(before.contexts.length + corpus.stats.glosses + corpus.stats.lexiconExamples);
    for (const source of corpus.articles) {
      const article = after.articles.find(a => a.id === source.id)!;
      expect(articleCollection(article)).toBe('extracurricular');
      expect(article.body).toBe(source.body);
      expect(article.translations).toEqual(source.translations.length ? source.translations : article.translations);
      for (const row of source.glosses) {
        const context = after.contexts.find(c => c.id === `beikao2027:context:${row.ref}`)!;
        expect(context.gloss).toBe(row.meaning);
        expect(context.verified).toBe(true);
        expect(getWord(after, context.senseId)).toBe(row.word);
        expect(article.body.slice(context.articleStart!, context.articleStart! + row.word.length)).toBe(row.word);
        expect(context.text.slice(context.start, context.start + row.word.length)).toBe(row.word);
        expect(context.source).toBe(`《${source.title}》 · 2027备考`);
      }
      for (const row of source.translations) {
        expect(article.body.slice(row.articleStart, row.articleStart + row.source.length)).toBe(row.source);
        expect(articleTranslationUnits(article)).toContainEqual({ articleStart: row.articleStart, source: row.source });
      }
    }
    const wuyou = corpus.articles[0], wuchen = corpus.articles[1];
    expect(wuyou.translations).toHaveLength(8);
    expect(wuyou.unresolved.length).toBe(26);
    expect(wuchen.body).toContain('[注释]①文化常识：伯仲叔季');
    expect(wuchen.body).not.toContain('盗版');
    expect(wuchen.glosses.map(g => g.word)).toContain('服阕');
    // 词库例句：无文章挂靠、出处标课文名，待核对行不通过审核。
    const example = after.contexts.find(c => c.id.startsWith('beikao2027:context:乌有-003:ex'))!;
    expect(example.articleId).toBeNull();
    expect(example.source).toBe('《师说》 · 乌有-003');
    expect(example.verified).toBe(true);
    expect(example.text.slice(example.start, example.start + 1)).toBe('齿');
    const pending = after.contexts.filter(c => c.id.startsWith('beikao2027:context:') && !c.verified);
    expect(pending).toHaveLength(4);
    const pendingSense = after.senses.find(sense => sense.id === pending[0].senseId)!;
    expect(pendingSense.note).toContain('待核对 2027备考:');
    expect(after.contexts.slice(0, before.contexts.length)).toEqual(before.contexts);
    expect(after.articles.slice(0, before.articles.length)).toEqual(before.articles);
    expect(after.cards).toEqual(before.cards); expect(after.reviews).toEqual(before.reviews); expect(after.readings).toEqual(before.readings);
    expect(new Set(after.entries.map(entry => entry.word)).size).toBe(after.entries.length);
    expect(validateDatabase(after)).toEqual(after);
    expect(mergeBeikao2027(after)).toEqual(after);
  });

  it('reuses a renamed text with different punctuation and retains personal annotations and translations', () => {
    const incoming = corpus.articles[0], first = incoming.glosses[0];
    const body = '前言。\n' + incoming.body.replaceAll('，', '；') + '\n后记。';
    const start = body.indexOf(first.word, '前言。\n'.length), sentence = sentenceAt(body, start);
    const before = createSeed();
    before.articles.push({ id: 'personal-beikao', title: '我整理的乌有先生传', author: '', era: '', body,
      summary: '个人笔记', sample: false, collection: 'extracurricular',
      translations: [{ id: 'personal-translation', articleStart: 4, source: incoming.translations[0].source.replaceAll('，', '；'), translation: '我核对的译文' }] });
    const personal = saveContext(before, { id: 'personal-context', word: first.word, meaning: '我核对的释义', note: '',
      text: sentence.text, start: sentence.start, source: '个人标注', articleId: 'personal-beikao', articleStart: start, verified: true });
    const after = mergeBeikao2027(personal);
    expect(after.articles).toHaveLength(personal.articles.length + 1);
    expect(after.articles.some(a => a.id === incoming.id)).toBe(false);
    const article = after.articles.find(a => a.id === 'personal-beikao')!;
    expect(article.body).toBe(body); expect(article.summary).toBe('个人笔记');
    expect(article.translations!.find(t => t.id === 'personal-translation')!.translation).toBe('我核对的译文');
    expect(after.contexts.find(c => c.id === 'personal-context')).toEqual(personal.contexts.find(c => c.id === 'personal-context'));
    expect(after.contexts.some(c => c.id === `beikao2027:context:${first.ref}`)).toBe(false);
    expect(mergeBeikao2027(after)).toEqual(after);
  });

  it('supports shared-lexicon recall and keeps the materials through complete backups and legacy migration', async () => {
    const before = mergeBeikao2027(createSeed()), now = new Date('2026-11-08T08:00:00Z');
    const context = before.contexts.find(c => c.id.startsWith('beikao2027:context:'))!;
    const learned = await gradeContext(await enroll(before, [context.senseId], now), context.id, 1, 'scheduled', now);
    expect(Date.parse(learned.cards[context.senseId].dueAt) - now.getTime()).toBe(60000);
    expect(parseBackup(exportText(learned))).toEqual(learned);
    expect(mergeBackup(emptyDatabase(), learned)).toEqual(learned);
    const migrated = mergeLegacySnapshot({ data: before, revision: 1, serverId: 'beikao2027', pristine: true }, createSeed());
    expect(migrated.articles.filter(a => a.id.startsWith('beikao2027:'))).toHaveLength(2);
    expect(migrated.contexts.filter(c => c.id.startsWith('beikao2027:'))).toHaveLength(corpus.stats.glosses + corpus.stats.lexiconExamples);
  });

  it('backs up and imports once without changing existing progress, and respects a later complete restore', async () => {
    const path = mkdtempSync(join(tmpdir(), 'inklex-beikao2027-')); paths.push(path);
    const old = open(path, false), initial = old.read(), context = initial.data.contexts.find(c => c.verified)!;
    const now = new Date('2026-11-08T08:00:00Z');
    const learned = await gradeContext(await enroll(initial.data, [context.senseId], now), context.id, 3, 'scheduled', now);
    learned.settings.dailyNew = 4;
    const before = old.write(learned, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.articles.slice(0, before.data.articles.length)).toEqual(before.data.articles);
    expect(after.data.contexts.slice(0, before.data.contexts.length)).toEqual(before.data.contexts);
    expect(after.data.cards).toEqual(before.data.cards); expect(after.data.reviews).toEqual(before.data.reviews);
    expect(after.data.readings).toEqual(before.data.readings); expect(after.data.settings).toEqual(before.data.settings);
    const backup = readdirSync(join(path, 'backups')).find(n => n.startsWith(`before-${BEIKAO_2027_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close(); expect(open(path).read()).toEqual(restored);
  });
});
