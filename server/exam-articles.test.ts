import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/exam-articles.json';
import { EXAM_ARTICLES_ID, mergeExamArticles } from './exam-articles';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { articleCollection, articleSentences, contextsFor, emptyDatabase, getWord, saveContext, sentenceAt, validateDatabase } from '../src/domain/model';
import { mergeLegacySnapshot } from '../src/domain/api';
import { enroll, gradeContext } from '../src/domain/scheduler';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'inklex-exam-articles-')); paths.push(path); return path; };
const open = (path: string, importExamArticles = true) => {
  const db = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false, importExamArticles, importRecitation: false });
  handles.push(db); return db;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('supplied exam answer reading passages', () => {
  it('retains every supplied primary translation, exact positions, footnotes and source provenance', () => {
    expect(corpus.sources.map(source => source.file)).toEqual([
      '综合练习四（静安）答案订正.docx', '综合练习七（2026金山2模）答案详解.docx', '10月30日高三语文周测答案.docx',
    ]);
    for (const source of corpus.sources) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    const before = createSeed(), after = mergeExamArticles(before);
    expect(corpus.stats).toEqual({ articles: 6, translations: 98, glosses: 88, pending: 0 });
    expect(after.articles).toHaveLength(before.articles.length + 6);
    for (const incoming of corpus.articles) {
      const article = after.articles.find(row => row.id === incoming.id)!;
      expect(articleCollection(article)).toBe('extracurricular');
      expect(article.body).toBe(incoming.body);
      expect(article.translations?.map(({ articleStart, source }) => ({ articleStart, source }))).toEqual(articleSentences(article.body));
      expect(article.translations!.map(row => row.translation).join('')).toBe(incoming.audit.map(row => row.translationSource).join(''));
      expect(article.translations!.map(row => row.source).join('')).toBe(article.body.replaceAll('\n', ''));
      expect(article.body).not.toMatch(/得分点|解析|19，|20[ABCD]|21，|[（(]/u);
      for (const row of article.translations!) expect(article.body.slice(row.articleStart, row.articleStart + row.source.length)).toBe(row.source);
    }
    expect(corpus.unresolved[0].file).toContain('静安');
    expect(after.articles.some(article => article.summary.includes('埒（liè）'))).toBe(true);
    expect(after.articles.find(article => article.title === '林仁肇传（节选）')?.summary).toContain('据首句拟题');
    expect(after.articles.find(article => article.title === '林仁肇传（节选）')?.body).toContain('国家衅其利');
    expect(after.cards).toEqual(before.cards); expect(after.reviews).toEqual(before.reviews); expect(after.readings).toEqual(before.readings);
    expect(validateDatabase(after)).toEqual(after);
    expect(mergeExamArticles(after)).toEqual(after);
  });

  it('uses all 88 explicit source glosses even when the full translation paraphrases them', () => {
    const before = createSeed(), after = mergeExamArticles(before);
    const contexts = after.contexts.filter(row => row.id.startsWith('exam2026:context:'));
    expect(contexts).toHaveLength(88);
    expect(contexts.every(row => row.verified)).toBe(true);
    for (const context of contexts) {
      const article = after.articles.find(row => row.id === context.articleId)!;
      const word = getWord(after, context.senseId);
      expect(article.body.slice(context.articleStart!, context.articleStart! + word.length)).toBe(word);
      expect(context.text.slice(context.start, context.start + word.length)).toBe(word);
      expect(after.entries.filter(entry => entry.word === word)).toHaveLength(1);
      expect(contextsFor(after, context.senseId)).toContainEqual(context);
      const supplied = corpus.articles.flatMap(article => article.glosses).find(row => context.id === `exam2026:context:${row.ref}`)!;
      expect(context.gloss).toBe(supplied.meaning);
      expect(context.source).not.toContain('待核对');
    }
    const shi = contexts.find(row => row.id === 'exam2026:context:jinshan:173:2')!;
    expect(getWord(after, shi.senseId)).toBe('事'); expect(shi.gloss).toBe('侍奉');
    expect(shi.text).toContain('事之如所生');
    const bi = contexts.find(context => getWord(after, context.senseId) === '币')!;
    expect(bi.gloss).toBe('钱币');
    const article = after.articles.find(row => row.id === bi.articleId)!;
    expect(article.translations!.some(row => row.translation.includes('礼物'))).toBe(true);
    const de = contexts.find(context => context.id === 'exam2026:context:jinshan:167:4')!;
    expect(de.gloss).toBe('完成，实现');
    expect(article.translations!.some(row => row.translation.includes('找到了他'))).toBe(true);
    expect(after.contexts.slice(0, before.contexts.length)).toEqual(before.contexts);
  });

  it('recognizes differently named, numbered copies in a longer original and fills only missing material', () => {
    const incoming = corpus.articles.find(article => article.id.endsWith(':li-kongzhao'))!;
    const data = createSeed();
    const body = `前文另记。\n${incoming.body.replace(/^/gm, '① ')}\n后文另记。`;
    const firstSentence = articleSentences(body)[1];
    data.articles.push({ id: 'my-li-kongzhao', title: '我已整理的李孔昭', author: '自录', era: '清', body,
      summary: '我的笔记', sample: false, collection: 'extracurricular',
      translations: [{ id: 'my-translation', ...firstSentence, translation: '我的原有译文' }] });
    const position = body.indexOf('孤介'), sentence = sentenceAt(body, position);
    const before = saveContext(data, { word: '孤介', meaning: '我核对过的解释', note: '个人笔记',
      text: sentence.text, start: sentence.start, source: '我的出处', articleId: 'my-li-kongzhao', articleStart: position, verified: true });
    const after = mergeExamArticles(before);
    expect(after.articles.some(article => article.id === incoming.id)).toBe(false);
    const existing = after.articles.find(article => article.id === 'my-li-kongzhao')!;
    expect(existing.body).toBe(body); expect(existing.summary).toBe('我的笔记'); expect(existing.author).toBe('自录');
    expect(existing.translations).toHaveLength(incoming.translations.length);
    expect(existing.translations![0].translation).toBe('我的原有译文');
    expect(after.contexts.slice(0, before.contexts.length)).toEqual(before.contexts);
    expect(after.contexts.filter(row => row.articleId === existing.id && getWord(after, row.senseId) === '孤介')).toHaveLength(1);
    expect(mergeExamArticles(after)).toEqual(after);
  });

  it('does not undo a personal edit of a previously installed text', () => {
    const data = mergeExamArticles(createSeed());
    const article = data.articles.find(row => row.id.endsWith(':qiushengfu'))!;
    article.body = '自己的课文修订。'; article.translations = [];
    expect(mergeExamArticles(data)).toEqual(data);
  });

  it('backs up an upgrade with real study history, imports once, and respects subsequent restores', async () => {
    const path = directory(), previous = open(path, false), snapshot = previous.read();
    const context = snapshot.data.contexts.find(row => row.verified)!;
    const now = new Date('2026-11-04T08:00:00Z');
    let data = await enroll(snapshot.data, [context.senseId], now);
    data = await gradeContext(data, context.id, 3, 'scheduled', now);
    data.settings.dailyNew = 4;
    const before = previous.write(data, snapshot.revision); previous.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1); expect(after.serverId).toBe(before.serverId);
    expect(after.data.articles.slice(0, data.articles.length)).toEqual(data.articles);
    expect(after.data.contexts.slice(0, data.contexts.length)).toEqual(data.contexts);
    expect(after.data.cards).toEqual(data.cards); expect(after.data.reviews).toEqual(data.reviews);
    expect(after.data.readings).toEqual(data.readings); expect(after.data.settings).toEqual(data.settings);
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith(`before-${EXAM_ARTICLES_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });

  it('leaves data and the import marker intact if the pre-import backup cannot be written', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    rmSync(join(path, 'backups'), { recursive: true, force: true });
    writeFileSync(join(path, 'backups'), 'blocked');
    expect(() => open(path)).toThrow();
    const unchanged = open(path, false); expect(unchanged.read()).toEqual(before); unchanged.close();
    rmSync(join(path, 'backups'));
    expect(open(path).read().data.articles).toHaveLength(before.data.articles.length + 6);
  });

  it('retains these articles, translations and linked vocabulary when migrating a legacy browser', () => {
    const snapshot = open(directory()).read();
    expect(snapshot.pristine).toBe(true);
    const legacy = createSeed(); legacy.settings.dailyNew = 6;
    const merged = mergeLegacySnapshot(snapshot, legacy);
    expect(merged.settings.dailyNew).toBe(6);
    expect(merged.articles.filter(article => article.id.startsWith('exam2026:article:'))).toHaveLength(6);
    expect(merged.contexts.filter(context => context.id.startsWith('exam2026:context:'))).toHaveLength(88);
    expect(validateDatabase(merged)).toEqual(merged);
  });
});
