import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/recitation-chenlan.json';
import { mergeRecitationChenlan, RECITATION_CHENLAN_ID } from './recitation-chenlan';
import { mergeRecitationSummary } from './recitation-summary';
import { mergeRecitationContent } from './recitation-content';
import { mergeTextbookArticles } from './textbook-articles';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { emptyDatabase, validateDatabase } from '../src/domain/model';
import { mergeBackup, parseBackup, exportText } from '../src/domain/storage';
import { checkRecitationAnswer, enrollRecitations, gradeRecitation } from '../src/domain/recitation';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const p = mkdtempSync(join(tmpdir(), 'inklex-recitations-chenlan-')); paths.push(p); return p; };
const open = (path: string, importRecitationChenlan = true) => {
  const h = new FileDatabase(path, { importSupplement: false, importTextbookArticles: false, importBiography2026: false,
    importRecitation: true, importRecitationSummary: true, importRecitationChenlan, importRecitationTopic01: false });
  handles.push(h); return h;
};
afterEach(() => {
  for (const db of handles.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const fixture = () => mergeRecitationSummary(mergeRecitationContent(mergeTextbookArticles(createSeed())));

describe('completed Chenqingbiao and Lantingji Xu recitations', () => {
  it('keeps all distinct prompts and exact answers, retaining the matching existing question', () => {
    const before = fixture(), after = mergeRecitationChenlan(before);
    expect(corpus.stats).toEqual({ questions: 37, answers: 75, works: 2 });
    expect(before.recitation!.questions).toHaveLength(286);
    expect(after.recitation!.questions).toHaveLength(322);
    expect(after.recitation!.questions.slice(0, 286)).toEqual(before.recitation!.questions);
    expect(after.recitation!.questions.find(q => q.id === 'recitation:chenqingbiao:015')).toBeDefined();
    expect(after.recitation!.questions.some(q => q.id === 'recitation:chenlan:chenqingbiao:001')).toBe(false);
    for (const incoming of corpus.questions.slice(1)) {
      const question = after.recitation!.questions.find(row => row.id === incoming.id)!;
      expect(question.prompt.match(/＿＿＿＿/g)).toHaveLength(incoming.answers.length);
      expect(question.answers).toEqual(incoming.answers);
      expect(question.note).toBe(incoming.note);
      expect(after.articles.some(article => article.id === question.articleId)).toBe(true);
    }
    const three = after.recitation!.questions.find(q => q.id === 'recitation:chenlan:lanting:012')!;
    expect(three.answers).toEqual(['向之所欣', '俯仰之间', '已为陈迹']);
    expect(after.recitation!.cards).toEqual(before.recitation!.cards);
    expect(after.recitation!.reviews).toEqual(before.recitation!.reviews);
    expect({ ...after, recitation: undefined }).toEqual({ ...before, recitation: undefined });
    expect(mergeRecitationChenlan(after)).toEqual(after);
    expect(validateDatabase(after)).toEqual(after);
  });

  it('accepts the explicitly noted variant but keeps the other note tied to different prompts', () => {
    const data = mergeRecitationChenlan(fixture());
    const question = data.recitation!.questions.find(q => q.id === 'recitation:chenlan:chenqingbiao:014')!;
    expect(question.note).toContain('原文完整表述为“但以刘日薄西山，气息奄奄”');
    expect(checkRecitationAnswer('日薄西山', question, 0).status).toBe('correct');
    expect(checkRecitationAnswer('但以刘日薄西山', question, 0).status).toBe('correct');
    expect(checkRecitationAnswer('但以刘日簿西山', question, 0).status).toBe('incorrect');
    const urgent = data.recitation!.questions.find(q => q.id === 'recitation:chenlan:chenqingbiao:017')!;
    expect(urgent.note).toBe('结合不同题干，也可能填写“州司临门，急于星火”。');
    expect(checkRecitationAnswer('诏书切峻', urgent, 0).status).toBe('correct');
    expect(checkRecitationAnswer('州司临门', urgent, 0).status).toBe('incorrect');
  });

  it('does not overwrite personal edits, and keeps extra notes even if a matching question exists', () => {
    const before = fixture(), noted = corpus.questions.find(q => q.number === 14 && q.work === '陈情表')!;
    before.recitation!.questions.push({ ...noted, id: 'personal-question', source: '自己的资料', note: '个人记录' });
    const data = mergeRecitationChenlan(before);
    expect(data.recitation!.questions.find(q => q.id === 'personal-question')!.note).toBe('个人记录');
    const imported = data.recitation!.questions.find(q => q.id === noted.id)!;
    expect(imported.note).toBe(noted.note);
    imported.prompt = '自己修订的题干。'; imported.note = '自己的笔记';
    expect(mergeRecitationChenlan(data)).toEqual(data);
  });

  it('supports scheduled recall and preserves the supplement and study history through backup merge', async () => {
    const before = mergeRecitationChenlan(fixture());
    const id = 'recitation:chenlan:lanting:012', now = new Date('2026-11-05T08:00:00Z');
    const learned = await gradeRecitation(await enrollRecitations(before, [id], now), id, 1, 'scheduled', ['向之所欣', '俯仰之间', '已为陈迹'], now);
    expect(Date.parse(learned.recitation!.cards[id].dueAt) - now.getTime()).toBe(60000);
    expect(learned.cards).toEqual(before.cards); expect(learned.reviews).toEqual(before.reviews);
    expect(parseBackup(exportText(learned))).toEqual(learned);
    const merged = mergeBackup(emptyDatabase(), learned);
    expect(merged.recitation!.questions).toHaveLength(322);
    expect(merged.recitation!.cards[id]).toEqual(learned.recitation!.cards[id]);
    expect(merged.recitation!.reviews).toEqual(learned.recitation!.reviews);
    expect(mergeBackup(merged, learned)).toEqual(merged);
  });

  it('backs up and imports once without altering existing progress, and respects a full restore', async () => {
    const path = directory(), old = open(path, false), initial = old.read();
    const id = initial.data.recitation!.questions[0].id, now = new Date('2026-11-05T08:00:00Z');
    const learned = await gradeRecitation(await enrollRecitations(initial.data, [id], now), id, 3, 'scheduled', [], now);
    learned.recitation!.dailyNew = 5;
    const before = old.write(learned, initial.revision); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.recitation!.questions).toHaveLength(322);
    expect(after.data.recitation!.questions.slice(0, 286)).toEqual(before.data.recitation!.questions);
    expect(after.data.recitation!.cards).toEqual(before.data.recitation!.cards);
    expect(after.data.recitation!.reviews).toEqual(before.data.recitation!.reviews);
    expect(after.data.recitation!.dailyNew).toBe(5);
    expect({ ...after.data, recitation: undefined }).toEqual({ ...before.data, recitation: undefined });
    const backup = readdirSync(join(path, 'backups')).find(name => name.startsWith(`before-${RECITATION_CHENLAN_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    upgraded.close(); const again = open(path); expect(again.read()).toEqual(after);
    const restored = again.write(emptyDatabase(), after.revision); again.close();
    expect(open(path).read()).toEqual(restored);
  });

  it('rolls back the upgrade if its pre-import backup cannot be written', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    rmSync(join(path, 'backups'), { recursive: true, force: true }); writeFileSync(join(path, 'backups'), 'blocked');
    expect(() => open(path)).toThrow();
    const unchanged = open(path, false); expect(unchanged.read()).toEqual(before); unchanged.close();
    rmSync(join(path, 'backups'));
    expect(open(path).read().data.recitation!.questions).toHaveLength(322);
  });
});
