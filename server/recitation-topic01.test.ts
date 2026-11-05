import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/recitation-topic01.json';
import { mergeRecitationTopic01, RECITATION_TOPIC01_ID } from './recitation-topic01';
import { mergeRecitationChenlan } from './recitation-chenlan';
import { mergeRecitationSummary } from './recitation-summary';
import { mergeRecitationContent } from './recitation-content';
import { mergeTextbookArticles } from './textbook-articles';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { emptyDatabase } from '../src/domain/model';
import { exportText, mergeBackup, parseBackup } from '../src/domain/storage';
import { checkRecitationAnswer, enrollRecitations, gradeRecitation } from '../src/domain/recitation';

const paths: string[] = [], handles: FileDatabase[] = [];
const open = (path: string, importRecitationTopic01 = true) => {
  const db = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false,
    importRecitation: true, importRecitationSummary: true, importRecitationChenlan: true, importRecitationTopic01 });
  handles.push(db); return db;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const fixture = () => mergeRecitationChenlan(mergeRecitationSummary(mergeRecitationContent(mergeTextbookArticles(createSeed()))));

describe('Topic 01 understanding-only recitations', () => {
  it('selects only the 16 meaning-based questions and aligns each with its own two answers', () => {
    expect(corpus.stats).toEqual({ questions: 16, answers: 32, works: 10 });
    expect(corpus.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(corpus.selection.selected.every(q => q.subquestion === 3)).toBe(true);
    expect(corpus.selection.excludedContinuationParagraphs).toHaveLength(32);
    expect(corpus.questions.map(q => q.answers)).toEqual([
      ['地崩山摧壮士死', '然后天梯石栈相钩连'], ['臣生当陨首', '死当结草'],
      ['丞相祠堂何处寻', '锦官城外柏森森'], ['万里悲秋常作客', '百年多病独登台'],
      ['锲而不舍', '金石可镂'], ['为之于未有', '治之于未乱'],
      ['《国风》好色而不淫', '《小雅》怨诽而不乱'], ['质胜文则野', '文胜质则史'],
      ['故有之以为利', '无之以为用'], ['一觞一咏', '亦足以畅叙幽情'],
      ['见贤思齐焉', '见不贤而内自省也'], ['万里悲秋常作客', '百年多病独登台'],
      ['己所不欲', '勿施于人'], ['但见悲鸟号古木', '雄飞雌从绕林间'],
      ['青青子衿', '悠悠我心'], ['故有之以为利', '无之以为用'],
    ]);
    const before = fixture(), after = mergeRecitationTopic01(before);
    expect(after.recitation!.questions).toHaveLength(338);
    expect(after.recitation!.questions.slice(0, 322)).toEqual(before.recitation!.questions);
    for (const incoming of corpus.questions) {
      const question = after.recitation!.questions.find(q => q.id === incoming.id)!;
      expect(question.prompt.match(/＿＿＿＿/g)).toHaveLength(2);
      expect(question.answers).toEqual(incoming.answers);
      expect(question.note).toBe(incoming.note);
      expect(after.articles.some(a => a.id === question.articleId)).toBe(true);
    }
    expect(after.recitation!.cards).toEqual(before.recitation!.cards);
    expect(after.recitation!.reviews).toEqual(before.recitation!.reviews);
    expect({ ...after, recitation: undefined }).toEqual({ ...before, recitation: undefined });
    expect(mergeRecitationTopic01(after)).toEqual(after);
  });

  it('retains distinct cues for identical answers and preserves existing personal edits', () => {
    const before = fixture(), incoming = corpus.questions[0];
    before.recitation!.questions.push({ ...incoming, id: 'personal-question', source: '个人题库', note: '自己的笔记' });
    const after = mergeRecitationTopic01(before);
    expect(after.recitation!.questions).toHaveLength(338);
    expect(after.recitation!.questions.some(q => q.id === incoming.id)).toBe(false);
    expect(after.recitation!.questions.find(q => q.id === 'personal-question')!.note).toBe('自己的笔记');
    const a = after.recitation!.questions.find(q => q.id === 'recitation:topic01:004')!;
    const b = after.recitation!.questions.find(q => q.id === 'recitation:topic01:012')!;
    expect(a.answers).toEqual(b.answers); expect(a.prompt).not.toBe(b.prompt);
    a.prompt = '我调整的题干'; a.answers = ['自己核对的原句', '第二空'];
    expect(mergeRecitationTopic01(after)).toEqual(after);
  });

  it('checks exact characters and supports independent scheduled recall and backup restoration', async () => {
    const before = mergeRecitationTopic01(fixture()), id = 'recitation:topic01:001';
    const question = before.recitation!.questions.find(q => q.id === id)!;
    expect(checkRecitationAnswer('地崩山摧壮士死', question, 0).status).toBe('correct');
    expect(checkRecitationAnswer('地崩山催壮士死', question, 0).parts).toContainEqual({ kind: 'replace', actual: '催', expected: '摧' });
    const now = new Date('2026-11-06T08:00:00Z');
    const learned = await gradeRecitation(await enrollRecitations(before, [id], now), id, 1, 'scheduled', question.answers, now);
    expect(Date.parse(learned.recitation!.cards[id].dueAt) - now.getTime()).toBe(60000);
    expect(learned.cards).toEqual(before.cards); expect(learned.reviews).toEqual(before.reviews);
    expect(parseBackup(exportText(learned))).toEqual(learned);
    const merged = mergeBackup(emptyDatabase(), learned);
    expect(merged.recitation!.questions).toHaveLength(338);
    expect(merged.recitation!.cards[id]).toEqual(learned.recitation!.cards[id]);
    expect(merged.recitation!.reviews).toEqual(learned.recitation!.reviews);
  });

  it('backs up the original state and imports once without disturbing study history or a later restore', async () => {
    const path = mkdtempSync(join(tmpdir(), 'inklex-topic01-')); paths.push(path);
    const old = open(path, false), initial = old.read();
    const id = initial.data.recitation!.questions[0].id, now = new Date('2026-11-06T08:00:00Z');
    const learned = await gradeRecitation(await enrollRecitations(initial.data, [id], now), id, 3, 'scheduled', [], now);
    learned.recitation!.dailyNew = 5;
    const before = old.write(learned, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.recitation!.questions).toHaveLength(338);
    expect(after.data.recitation!.questions.slice(0, 322)).toEqual(before.data.recitation!.questions);
    expect(after.data.recitation!.cards).toEqual(before.data.recitation!.cards);
    expect(after.data.recitation!.reviews).toEqual(before.data.recitation!.reviews);
    expect(after.data.recitation!.dailyNew).toBe(5);
    expect({ ...after.data, recitation: undefined }).toEqual({ ...before.data, recitation: undefined });
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith(`before-${RECITATION_TOPIC01_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });
});
