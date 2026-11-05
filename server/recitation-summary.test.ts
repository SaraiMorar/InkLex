import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/recitation-summary.json';
import { mergeRecitationSummary, RECITATION_SUMMARY_ID } from './recitation-summary';
import { mergeRecitationContent } from './recitation-content';
import { mergeTextbookArticles } from './textbook-articles';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { emptyDatabase, validateDatabase } from '../src/domain/model';
import { mergeBackup, parseBackup, exportText } from '../src/domain/storage';
import { mergeLegacySnapshot } from '../src/domain/api';
import { checkRecitationAnswer, enrollRecitations, gradeRecitation } from '../src/domain/recitation';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const p = mkdtempSync(join(tmpdir(), 'inklex-recitations-summary-')); paths.push(p); return p; };
const open = (path: string, importRecitationSummary = true) => {
  const h = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false,
    importRecitation: true, importRecitationSummary, importRecitationChenlan: false });
  handles.push(h); return h;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const fixture = () => mergeRecitationContent(mergeTextbookArticles(createSeed()));

describe('provided filled recitation collection', () => {
  it('imports all complete questions and exact marked answers while preserving notes and existing material', () => {
    const before = fixture(), after = mergeRecitationSummary(before);
    expect(corpus.stats).toEqual({ questions: 209, answers: 476, works: 19 });
    expect(corpus.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(corpus.incomplete).toHaveLength(1);
    expect(after.recitation!.questions).toHaveLength(286);
    expect(after.recitation!.questions.slice(0, 77)).toEqual(before.recitation!.questions);
    expect(after.recitation!.cards).toEqual(before.recitation!.cards);
    expect(after.recitation!.reviews).toEqual(before.recitation!.reviews);
    expect({ ...after, recitation: undefined }).toEqual({ ...before, recitation: undefined });
    for (const incoming of corpus.questions) {
      const question = after.recitation!.questions.find(row => row.id === incoming.id)!;
      expect(question).toBeDefined();
      expect(question.prompt.match(/＿＿＿＿/g)).toHaveLength(incoming.answers.length);
      expect(question.answers).toEqual(incoming.answers);
      expect(question.note).toBe(incoming.note);
      expect(after.articles.some(article => article.id === question.articleId)).toBe(true);
    }
    expect(new Set(corpus.questions.map(question => question.work)).size).toBe(19);
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0059')!.answers[1]).toBe('輮使之然也');
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0202')!.answers[0]).toContain('鞿羁');
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0205')!.answers[0]).toContain('蕙纕');
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0205')!.note).toContain('书架现有');
    expect(corpus.stemCorrections.map(row => row.paragraph)).toEqual([31, 112, 140, 176]);
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0112')!.prompt).toContain('肯定公西华');
    expect(corpus.questions.find(q => q.id === 'recitation:summary:0112')!.note).toContain('原题把人物写成“子路”有误');
    expect(mergeRecitationSummary(after)).toEqual(after);
    expect(validateDatabase(after)).toEqual(after);
  });

  it('keeps repeated numbered source questions and both sets of progress through backup merge', async () => {
    const before = mergeRecitationSummary(fixture());
    const a = before.recitation!.questions.find(q => q.id === 'recitation:summary:0084')!;
    const b = before.recitation!.questions.find(q => q.id === 'recitation:summary:0091')!;
    expect([a.number, b.number]).toEqual([30, 37]);
    expect(a.prompt).toBe(b.prompt); expect(a.answers).toEqual(b.answers);
    const now = new Date('2026-11-05T08:00:00Z');
    let data = await enrollRecitations(before, [a.id, b.id], now);
    data = await gradeRecitation(data, a.id, 1, 'scheduled', ['', ''], now);
    data = await gradeRecitation(data, b.id, 3, 'scheduled', ['', ''], new Date(now.getTime() + 1000));
    expect(parseBackup(exportText(data))).toEqual(data);
    const merged = mergeBackup(emptyDatabase(), data);
    expect(merged.recitation!.questions).toHaveLength(286);
    expect(merged.recitation!.cards[a.id]).toEqual(data.recitation!.cards[a.id]);
    expect(merged.recitation!.cards[b.id]).toEqual(data.recitation!.cards[b.id]);
    expect(merged.recitation!.reviews).toEqual(data.recitation!.reviews);
    expect(mergeBackup(merged, data)).toEqual(merged);
    expect(mergeLegacySnapshot({ data: before, revision: 1, serverId: 'summary', pristine: true }, createSeed()).recitation!.questions).toHaveLength(286);
  });

  it('recognizes an identical existing question and does not overwrite personal edits', () => {
    const before = fixture(), incoming = corpus.questions[0];
    before.recitation!.questions.push({ ...incoming, id: 'personal-question', source: '自己的资料', note: '个人记录' });
    const data = mergeRecitationSummary(before);
    expect(data.recitation!.questions).toHaveLength(286);
    expect(data.recitation!.questions.find(q => q.id === 'personal-question')!.note).toBe('个人记录');
    expect(data.recitation!.questions.some(q => q.id === incoming.id)).toBe(false);
    const changed = data.recitation!.questions.find(q => q.id === 'recitation:summary:0005')!;
    changed.prompt = '我自己核对的题干。'; changed.note = '自己的笔记';
    expect(mergeRecitationSummary(data)).toEqual(data);
  });

  it('makes answers usable in ordinary recall, including the provided rare character', async () => {
    const data = mergeRecitationSummary(fixture());
    const question = data.recitation!.questions.find(q => q.id === 'recitation:summary:0205')!;
    expect(checkRecitationAnswer('既替余以蕙纕兮，', question, 0).status).toBe('correct');
    expect(checkRecitationAnswer('既替余以蕙兮', question, 0).parts).toContainEqual({ kind: 'missing', actual: '', expected: '纕' });
    const now = new Date('2026-11-05T08:00:00Z');
    const graded = await gradeRecitation(await enrollRecitations(data, [question.id], now), question.id, 1, 'scheduled', [], now);
    expect(Date.parse(graded.recitation!.cards[question.id].dueAt) - now.getTime()).toBe(60000);
    expect(graded.cards).toEqual(data.cards); expect(graded.reviews).toEqual(data.reviews);
  });

  it('accepts the source-noted alternate pair without accepting lines mixed from different pairs', () => {
    const data = mergeRecitationSummary(fixture());
    const question = data.recitation!.questions.find(q => q.id === 'recitation:summary:0220')!;
    const alternate = ['蚕丛及鱼凫', '开国何茫然'];
    expect(question.alternativeSets).toEqual([alternate]);
    expect(alternate.map((answer, index) => checkRecitationAnswer(answer, question, index, alternate).status)).toEqual(['correct', 'correct']);
    const mixed = [question.answers[0], alternate[1]];
    expect(mixed.map((answer, index) => checkRecitationAnswer(answer, question, index, mixed).status)).toContain('incorrect');
    const broken = structuredClone(data);
    broken.recitation!.questions.find(q => q.id === question.id)!.alternativeSets = [['只有一空']];
    expect(() => validateDatabase(broken)).toThrow('备选答案组数量');
  });

  it('backs up and imports once without disturbing actual existing study history, then respects a full restore', async () => {
    const path = directory(), old = open(path, false), initial = old.read();
    const questionId = initial.data.recitation!.questions[0].id, now = new Date('2026-11-05T08:00:00Z');
    const learned = await gradeRecitation(await enrollRecitations(initial.data, [questionId], now), questionId, 3, 'scheduled', [], now);
    learned.recitation!.dailyNew = 5;
    const before = old.write(learned, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.recitation!.questions).toHaveLength(286);
    expect(after.data.recitation!.questions.slice(0, 77)).toEqual(before.data.recitation!.questions);
    expect(after.data.recitation!.cards).toEqual(before.data.recitation!.cards);
    expect(after.data.recitation!.reviews).toEqual(before.data.recitation!.reviews);
    expect(after.data.recitation!.dailyNew).toBe(5);
    expect({ ...after.data, recitation: undefined }).toEqual({ ...before.data, recitation: undefined });
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith(`before-${RECITATION_SUMMARY_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });

  it('rolls back an upgrade if its pre-import backup cannot be written', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    rmSync(join(path, 'backups'), { recursive: true, force: true }); writeFileSync(join(path, 'backups'), 'blocked');
    expect(() => open(path)).toThrow();
    const unchanged = open(path, false); expect(unchanged.read()).toEqual(before); unchanged.close();
    rmSync(join(path, 'backups'));
    expect(open(path).read().data.recitation!.questions).toHaveLength(286);
  });
});
