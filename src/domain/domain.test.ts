import { describe, expect, it } from 'vitest';
import { contextsFor, emptyDatabase, getWord, importLines, saveArticle, saveContext, sentenceAt, validateDatabase, type Database } from './model';
import { chooseContext, dailyStats, enroll, gradeContext, localDay, memoryCurve, previewGrades, studiedToday, studyQueue } from './scheduler';
import { createSeed } from './seed';
import { exportText, mergeBackup, parseBackup, readDatabase, STORAGE_KEY, writeDatabase } from './storage';

const at = new Date('2026-10-30T02:00:00.000Z');
function fixture() {
  let data = emptyDatabase();
  for (const [word, meaning, text] of [['顾', '拜访', '三顾臣于草庐之中。'], ['顾', '看', '顾野有麦场。'], ['顾', '拜访', '将军宜枉驾顾之。']]) {
    data = saveContext(data, { word, meaning, text, start: text.indexOf(word), source: '', note: '', articleId: null, articleStart: null, verified: true });
  }
  return data;
}

describe('content and occurrence integrity', () => {
  it('keeps distinct meanings and reuses a sense across contexts', () => {
    const d = fixture();
    expect(d.entries).toHaveLength(1); expect(d.senses).toHaveLength(2); expect(d.contexts).toHaveLength(3);
    expect(contextsFor(d, d.senses[0].id)).toHaveLength(2);
  });
  it('all sample annotations match their full text and original sentence', () => {
    const data = createSeed();
    expect(validateDatabase(data)).toEqual(data);
    expect(data.articles).toHaveLength(3);
    expect(data.contexts.length).toBeGreaterThan(25);
    expect(data.reviews).toHaveLength(0);
    expect(Object.keys(data.cards)).toHaveLength(0);
  });
  it('locates repeated words independently and rejects overlapping marks', () => {
    let d = saveArticle(emptyDatabase(), { id: 'a', title: '测试', author: '', era: '', body: '顾而顾。', summary: '', sample: false });
    d = saveContext(d, { word: '顾', meaning: '看', ...sentenceAt('顾而顾。', 2), articleId: 'a', articleStart: 2, source: '', note: '', verified: true });
    expect(d.contexts[0].start).toBe(2);
    expect(() => saveContext(d, { word: '顾', meaning: '拜访', ...sentenceAt('顾而顾。', 2), articleId: 'a', articleStart: 2, source: '', note: '', verified: true })).toThrow('重叠');
    d = saveContext(d, { word: '顾', meaning: '拜访', ...sentenceAt('顾而顾。', 0), articleId: 'a', articleStart: 0, source: '', note: '', verified: true });
    expect(d.contexts).toHaveLength(2); expect(d.senses).toHaveLength(2);
  });
  it('requires rechecking after full-text edits and excludes those contexts from review', async () => {
    let d = createSeed(); const article = d.articles[0];
    const ids = d.contexts.filter(c => c.articleId === article.id).map(c => c.senseId);
    d = await enroll(d, ids, at);
    expect(studyQueue(d, at, [article.id]).length).toBeGreaterThan(0);
    d = saveArticle(d, { ...article, body: `新增一段。\n${article.body}` });
    expect(d.contexts.filter(c => c.articleId === article.id).every(c => !c.verified)).toBe(true);
    expect(studyQueue(d, at, [article.id])).toHaveLength(0);
    expect(Object.keys(d.cards)).toHaveLength(ids.length);
  });
  it('rejects wrong offsets and missing references in backups', () => {
    const bad = fixture(); bad.contexts[0].start = 99;
    expect(() => validateDatabase(bad)).toThrow('标注位置');
    const missing = fixture(); missing.entries = [];
    expect(() => parseBackup(exportText(missing))).toThrow();
  });
  it('imports TSV atomically and handles repeated word selection', () => {
    const d = emptyDatabase();
    expect(() => importLines(d, '顾\t看\t顾而顾。\t自录\t2\n去\t离开\t没有这个字。')).toThrow('第 2 行');
    expect(d.contexts).toHaveLength(0);
    const next = importLines(d, '顾\t看\t顾而顾。\t自录\t2');
    expect(next.contexts[0].start).toBe(2);
    expect(() => importLines(next, '顾\t看\t顾而顾。\t自录\t2')).toThrow('已经存在');
  });
});

describe('real FSRS scheduling', () => {
  it('enrolls the same sense once without changing existing progress', async () => {
    const d = fixture(), senseId = d.senses[0].id;
    let next = await enroll(d, [senseId, senseId], at);
    expect(Object.keys(next.cards)).toHaveLength(1);
    next = await gradeContext(next, d.contexts[0].id, 3, 'scheduled', at);
    const again = await enroll(next, [senseId], new Date(at.getTime() + 1000));
    expect(again.cards).toEqual(next.cards);
  });
  it('Again becomes due after one minute and cannot be graded early twice', async () => {
    const d = fixture(), id = d.senses[0].id;
    const next = await gradeContext(await enroll(d, [id], at), d.contexts[0].id, 1, 'scheduled', at);
    expect(Date.parse(next.cards[id].dueAt) - at.getTime()).toBe(60000);
    expect(studyQueue(next, new Date(at.getTime() + 59000))).toEqual([]);
    expect(studyQueue(next, new Date(at.getTime() + 60000))).toEqual([id]);
    await expect(gradeContext(next, d.contexts[0].id, 3, 'scheduled', at)).rejects.toThrow('尚未到期');
    expect(next.reviews).toHaveLength(1);
    expect(next.reviews[0].nativeLog).toHaveProperty('rating', 1);
  });
  it('graduates Good learning and reschedules overdue failures into relearning', async () => {
    const d = fixture(), id = d.senses[0].id;
    let next = await gradeContext(await enroll(d, [id], at), d.contexts[0].id, 3, 'scheduled', at);
    expect(Date.parse(next.cards[id].dueAt) - at.getTime()).toBe(600000);
    const learningDue = new Date(next.cards[id].dueAt);
    next = await gradeContext(next, d.contexts[0].id, 3, 'scheduled', learningDue);
    expect(next.cards[id].state).toBe(2);
    const overdue = new Date(Date.parse(next.cards[id].dueAt) + 86400000 * 15);
    expect(studyQueue(next, overdue)).toEqual([id]);
    next = await gradeContext(next, d.contexts[0].id, 1, 'scheduled', overdue);
    expect(next.cards[id].state).toBe(3);
    expect(Date.parse(next.cards[id].dueAt) - overdue.getTime()).toBe(600000);
    expect(next.cards[id].lapses).toBe(1);
    expect(next.cards[id].lastReviewAt).toBe(overdue.toISOString());
  });
  it('uses ratings and retention to compute genuinely different intervals', async () => {
    const d = fixture(), id = d.senses[0].id;
    const next = await enroll(d, [id], at);
    const p = await previewGrades(next, id, at);
    expect(Date.parse(p[1])).toBeLessThan(Date.parse(p[3]));
    expect(Date.parse(p[3])).toBeLessThan(Date.parse(p[4]));
    const low = { ...next, settings: { ...next.settings, retention: .7 } };
    const high = { ...next, settings: { ...next.settings, retention: .97 } };
    const [a, b] = await Promise.all([gradeContext(low, d.contexts[0].id, 4, 'scheduled', at), gradeContext(high, d.contexts[0].id, 4, 'scheduled', at)]);
    expect(Date.parse(a.cards[id].dueAt)).toBeGreaterThan(Date.parse(b.cards[id].dueAt));
    const curve = await memoryCurve(a, id);
    expect(curve[0].probability).toBe(1);
    expect(curve.at(-1)!.probability).toBeLessThan(curve[1].probability);
  });
  it('practice keeps official state and daily new counts intact', async () => {
    const d = fixture(), id = d.senses[0].id;
    const before = await enroll(d, [id], at);
    const next = await gradeContext(before, d.contexts[0].id, 4, 'practice', at);
    expect(next.cards).toEqual(before.cards);
    expect(next.reviews[0].mode).toBe('practice');
    expect(studiedToday(next, at)).toBe(0);
    expect(dailyStats(next, at).done).toBe(0);
  });
  it('applies the daily new cap globally, never hides due cards, and resets by local date', async () => {
    const d = fixture(); d.settings.dailyNew = 1;
    const start = new Date(2026, 9, 30, 23, 59);
    let next = await enroll(d, d.senses.map(s => s.id), start);
    expect(studyQueue(next, start)).toHaveLength(1);
    next = await gradeContext(next, d.contexts[0].id, 1, 'scheduled', start);
    expect(studiedToday(next, start)).toBe(1); expect(studyQueue(next, start)).toHaveLength(0);
    const tomorrow = new Date(2026, 9, 31, 0, 1);
    expect(localDay(start)).not.toBe(localDay(tomorrow)); expect(studyQueue(next, tomorrow)).toHaveLength(2);
    next.settings.dailyNew = 0;
    expect(studyQueue(next, tomorrow)).toEqual([d.senses[0].id]);
  });
  it('rotates only learned contexts, keeping meanings independent', async () => {
    const d = fixture(); const id = d.senses[0].id;
    let next = await enroll(d, d.senses.map(s => s.id), at);
    next.contexts = next.contexts.map(c => ({ ...c, learned: true }));
    expect(chooseContext(next, id)!.id).toBe(d.contexts[0].id);
    next = await gradeContext(next, d.contexts[0].id, 3, 'scheduled', at);
    expect(chooseContext(next, id)!.id).toBe(d.contexts[2].id);
    expect(next.cards[d.senses[1].id].state).toBe(0);
  });
});

describe('backup and storage safety', () => {
  it('round trips cards, logs, dates and settings and resumes scheduling', async () => {
    let d = fixture(); d = await enroll(d, d.senses.map(s => s.id), at);
    d = await gradeContext(d, d.contexts[0].id, 1, 'scheduled', at);
    const restored = parseBackup(exportText(d));
    expect(restored).toEqual(d);
    expect(studyQueue(restored, new Date(at.getTime() + 60001))).toEqual(studyQueue(d, new Date(at.getTime() + 60001)));
    const again = await gradeContext(restored, d.contexts[0].id, 3, 'scheduled', new Date(at.getTime() + 60001));
    expect(again.reviews).toHaveLength(2);
  });
  it('merges semantically identical entries and is idempotent without overwriting progress', async () => {
    let current = fixture(); current = await enroll(current, current.senses.map(s => s.id), at);
    current = await gradeContext(current, current.contexts[0].id, 4, 'scheduled', at);
    const incoming = fixture();
    const merged = mergeBackup(current, incoming);
    expect(merged.entries).toHaveLength(1); expect(merged.senses).toHaveLength(2); expect(merged.contexts).toHaveLength(3);
    expect(merged.cards).toEqual(current.cards);
    expect(mergeBackup(merged, incoming)).toEqual(merged);
  });
  it('preserves imported history for newly added senses exactly once', async () => {
    let incoming = fixture(); incoming = await enroll(incoming, incoming.senses.map(s => s.id), at);
    incoming = await gradeContext(incoming, incoming.contexts[0].id, 3, 'scheduled', at);
    const merged = mergeBackup(emptyDatabase(), incoming);
    expect(merged.reviews).toHaveLength(1); expect(merged.cards).toEqual(incoming.cards);
    expect(mergeBackup(merged, incoming)).toEqual(merged);
  });
  it('rejects corrupt, unsupported and oversized files while preserving existing storage', () => {
    expect(() => parseBackup('{')).toThrow('有效');
    expect(() => parseBackup(JSON.stringify({ ...fixture(), version: 99 }))).toThrow('版本');
    expect(() => parseBackup('x'.repeat(15_000_001))).toThrow('15 MB');
    const raw = '{bad';
    const storage = { getItem: (key: string) => key === STORAGE_KEY ? raw : null };
    expect(() => readDatabase(storage)).toThrow(); expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(() => writeDatabase({ setItem: () => { throw new Error('QuotaExceeded'); } }, fixture())).toThrow('QuotaExceeded');
  });
});
