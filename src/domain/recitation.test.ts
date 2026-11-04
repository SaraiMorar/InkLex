import { describe, expect, it } from 'vitest';
import { createSeed } from './seed';
import { emptyDatabase, validateDatabase } from './model';
import { checkRecitationAnswer, enrollRecitations, gradeRecitation, recitationQueue, recitationState, recitationStats } from './recitation';
import { exportText, mergeBackup, parseBackup } from './storage';
import { mergeLegacySnapshot } from './api';
import { mergeRecitationContent } from '../../server/recitation-content';
import { mergeTextbookArticles } from '../../server/textbook-articles';

const at = new Date('2026-11-05T08:00:00Z');
const fixture = () => mergeRecitationContent(createSeed());

describe('understanding recitation content and recall', () => {
  it('imports only the 77 requested questions with matched blanks, precise answers and no study activity', () => {
    const before = mergeTextbookArticles(createSeed()), data = mergeRecitationContent(before), state = recitationState(data);
    expect(state.questions).toHaveLength(77);
    expect(['陈情表', '离骚', '兰亭集序'].map(work => state.questions.filter(q => q.work === work).length)).toEqual([42, 20, 15]);
    for (const question of state.questions) {
      expect(question.prompt.match(/＿＿＿＿/g)).toHaveLength(question.answers.length);
      expect(question.prompt).not.toMatch(/祭十二郎文|重点知识归类|明确特殊句式|标出词类活用/);
      expect(question.answers.every(answer => answer.trim().length > 0)).toBe(true);
      expect(data.articles.some(article => article.id === question.articleId)).toBe(true);
    }
    expect(state.questions.find(q => q.id === 'recitation:lisao:005')!.answers[0]).toBe('余虽好修姱以鞿羁兮');
    expect(state.questions.find(q => q.id === 'recitation:lisao:014')!.answers).toEqual(['既替余以蕙纕兮', '又申之以揽茝']);
    expect(state.questions.find(q => q.id === 'recitation:chenqingbiao:026')!.answers).toEqual(['以孝治天下', '是以区区不能废远']);
    expect(state.questions.find(q => q.id === 'recitation:lanting:013')!.answers).toHaveLength(4);
    expect(state.cards).toEqual({}); expect(state.reviews).toEqual([]);
    expect({ ...data, recitation: undefined }).toEqual({ ...before, recitation: undefined });
    expect(mergeRecitationContent(data)).toEqual(data);
  });

  it('ignores punctuation and whitespace while distinguishing exact, wrong, missing and extra characters', () => {
    const question = fixture().recitation!.questions[0];
    expect(checkRecitationAnswer(' 臣以险衅，\n', question, 0).status).toBe('correct');
    expect(checkRecitationAnswer('臣以险畔', question, 0)).toMatchObject({ status: 'incorrect', parts: expect.arrayContaining([{ kind: 'replace', actual: '畔', expected: '衅' }]) });
    expect(checkRecitationAnswer('臣险衅', question, 0).parts).toContainEqual({ kind: 'missing', actual: '', expected: '以' });
    expect(checkRecitationAnswer('臣以险衅也', question, 0).parts).toContainEqual({ kind: 'extra', actual: '也', expected: '' });
    expect(checkRecitationAnswer('', question, 0).status).toBe('empty');
    const mountain = fixture().recitation!.questions.find(q => q.id === 'recitation:lanting:001')!;
    expect(checkRecitationAnswer('崇山峻岭', mountain, 0).status).toBe('correct');
    const rare = fixture().recitation!.questions.find(q => q.id === 'recitation:lisao:005')!;
    expect(checkRecitationAnswer('余虽好修姱以羁兮', rare, 0).parts).toContainEqual({ kind: 'missing', actual: '', expected: '鞿' });
  });

  it('schedules actual FSRS relearning and rejects early or duplicate formal grading', async () => {
    const before = fixture(), id = before.recitation!.questions[0].id;
    const enrolled = await enrollRecitations(before, [id, id], at);
    expect(Object.keys(enrolled.recitation!.cards)).toEqual([id]);
    expect(await enrollRecitations(enrolled, [id], at)).toEqual(enrolled);
    const data = await gradeRecitation(enrolled, id, 1, 'scheduled', ['臣以险畔', ''], at);
    expect(Date.parse(data.recitation!.cards[id].dueAt) - at.getTime()).toBe(60000);
    expect(recitationQueue(data, new Date(at.getTime() + 59000))).toEqual([]);
    expect(recitationQueue(data, new Date(at.getTime() + 60000))).toEqual([id]);
    await expect(gradeRecitation(data, id, 3, 'scheduled', [], at)).rejects.toThrow('尚未到期');
    expect(data.recitation!.reviews[0].nativeLog).toHaveProperty('rating', 1);
    expect(data.recitation!.reviews[0].responses).toEqual(['臣以险畔', '']);
    expect(data.cards).toEqual(before.cards); expect(data.reviews).toEqual(before.reviews);
    expect(validateDatabase(data)).toEqual(data);
  });

  it('enforces the new-question limit across scopes with the same 3 AM study-day boundary', async () => {
    const data = fixture(), [a, b] = data.recitation!.questions;
    data.recitation!.dailyNew = 1;
    const beforeBoundary = new Date(2026, 10, 5, 2, 59), afterBoundary = new Date(2026, 10, 5, 3, 0);
    const graded = await gradeRecitation(await enrollRecitations(data, [a.id, b.id], beforeBoundary), a.id, 3, 'scheduled', [], beforeBoundary);
    expect(recitationQueue(graded, beforeBoundary, [b.id])).toEqual([]);
    await expect(gradeRecitation(graded, b.id, 3, 'scheduled', [], beforeBoundary)).rejects.toThrow('新题上限');
    expect(recitationStats(graded, afterBoundary).newToday).toBe(0);
    expect(recitationQueue(graded, afterBoundary, [b.id])).toEqual([b.id]);
    graded.recitation!.dailyNew = 0;
    expect(recitationQueue(graded, new Date(beforeBoundary.getTime() + 86400000))).toEqual([a.id]);
    expect(recitationQueue(graded, afterBoundary, [])).toEqual([]);
  });

  it('logs free recall without changing formal due dates or vocabulary activity', async () => {
    const data = fixture(), id = data.recitation!.questions[0].id;
    const enrolled = await enrollRecitations(data, [id], at);
    const practiced = await gradeRecitation(enrolled, id, 4, 'practice', [], at);
    expect(practiced.recitation!.cards).toEqual(enrolled.recitation!.cards);
    expect(practiced.recitation!.reviews[0]).toMatchObject({ mode: 'practice', before: null, after: null, nativeLog: null });
    expect(recitationStats(practiced, at).newToday).toBe(0);
    expect(practiced.cards).toEqual(data.cards); expect(practiced.reviews).toEqual(data.reviews); expect(practiced.readings).toEqual(data.readings);
  });

  it('roundtrips backups, merges idempotently and retains content during an old-browser migration', async () => {
    const data = fixture(), id = data.recitation!.questions[0].id;
    const graded = await gradeRecitation(await enrollRecitations(data, [id], at), id, 3, 'scheduled', [], at);
    expect(parseBackup(exportText(graded))).toEqual(graded);
    const merged = mergeBackup(emptyDatabase(), graded);
    expect(merged.recitation).toEqual(graded.recitation);
    expect(mergeBackup(merged, graded)).toEqual(merged);
    const old = createSeed(); old.settings.dailyNew = 7;
    const migrated = mergeLegacySnapshot({ data, revision: 1, serverId: 'recitation-test', pristine: true }, old);
    expect(migrated.recitation!.questions).toHaveLength(77);
    expect(migrated.recitation!.cards).toEqual({}); expect(migrated.settings.dailyNew).toBe(7);
    const edited = structuredClone(graded); edited.recitation!.questions[0].answers = ['我自己的核对答案']; edited.recitation!.questions[0].alternatives = [[]];
    delete edited.recitation!.cards[id];
    expect(mergeBackup(edited, graded).recitation!.cards[id]).toBeUndefined();
    expect(mergeBackup(edited, graded).recitation!.questions[0].answers).toEqual(['我自己的核对答案']);
  });

  it('accepts old backups and rejects dangling or malformed recitation progress', () => {
    expect(validateDatabase(createSeed()).recitation).toBeUndefined();
    const data = fixture(); data.recitation!.questions.push(data.recitation!.questions[0]);
    expect(() => validateDatabase(data)).toThrow('重复编号');
    const invalid = fixture(); invalid.recitation!.questions[0].alternatives = [];
    expect(() => validateDatabase(invalid)).toThrow('备选答案');
  });
});
