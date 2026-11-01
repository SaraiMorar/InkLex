import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/textbook-glosses.json';
import { FileDatabase } from './database';
import { mergeTextbookArticles } from './textbook-articles';
import { mergeTextbookGlosses, TEXTBOOK_GLOSSES_ID, textbookGlossStats } from './textbook-glosses';
import { getWord, saveContext } from '../src/domain/model';
import { createSeed } from '../src/domain/seed';
import { enroll, gradeContext } from '../src/domain/scheduler';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'inklex-textbook-glosses-')); paths.push(path); return path; };
const open = (path: string, importTextbookGlosses = true) => {
  const handle = new FileDatabase(path, { importTextbookArticles: true, importTextbookGlosses });
  handles.push(handle); return handle;
};
afterEach(() => {
  for (const handle of handles.splice(0)) { try { handle.close(); } catch { /* already closed */ } }
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('five-volume textbook gloss import', () => {
  it('links all 3,757 supplied explanations to the exact non-overlapping places in 71 articles', () => {
    const before = mergeTextbookArticles(createSeed()), after = mergeTextbookGlosses(before);
    const imported = after.contexts.filter(context => context.id.startsWith('textbook5:context:'));
    expect(textbookGlossStats).toMatchObject({ records: 3757, articles: 71, quoteRepairs: 9 });
    expect(imported).toHaveLength(3757);
    expect(new Set(imported.map(context => context.articleId)).size).toBe(71);
    expect(imported.every(context => context.verified && context.articleStart !== null)).toBe(true);
    expect(mergeTextbookGlosses(after)).toEqual(after);
    expect(after.articles.filter(article => article.id.startsWith('textbook5:article:'))
      .every(article => article.summary.includes('已关联字词释义'))).toBe(true);
    const byTitle = (title: string) => {
      const article = after.articles.find(row => row.title === title)!;
      return imported.filter(context => context.articleId === article.id);
    };
    const answer = byTitle('答司马谏议书').filter(context => getWord(after, context.senseId) === '度'
      && context.text.includes('盘庚不为怨者故'));
    expect(answer.map(context => context.gloss)).toEqual(['计划', '考虑，思量']);
    expect(new Set(answer.map(context => context.articleStart)).size).toBe(2);
    const mud = byTitle('屈原列传').filter(context => getWord(after, context.senseId) === '泥'
      && context.text.includes('自疏濯淖污泥'));
    expect(mud.map(context => context.gloss)).toEqual(['都是“污浊”的意思', '同“涅”，染黑']);
    expect(new Set(mud.map(context => context.articleStart)).size).toBe(2);
    const duty = byTitle('陈情表').filter(context => getWord(after, context.senseId) === '当'
      && context.text.includes('臣生当陨首'));
    expect(duty).toHaveLength(2); expect(new Set(duty.map(context => context.articleStart)).size).toBe(2);
    expect(imported.find(context => context.id === 'textbook5:context:0489')?.gloss).toBe('“狼藉”，凌乱');
  });

  it('keeps existing progress and lets a personal annotation win at an occupied position', async () => {
    let data = mergeTextbookArticles(createSeed());
    const oldContext = data.contexts[0], now = new Date('2026-11-01T02:00:00Z');
    data = await enroll(data, [oldContext.senseId], now);
    data = await gradeContext(data, oldContext.id, 3, 'scheduled', now);
    const card = structuredClone(data.cards), reviews = structuredClone(data.reviews), readings = structuredClone(data.readings);
    const row = corpus.records[0];
    data = saveContext(data, { word: row.word, meaning: '我核对过的个人释义', note: '', text: row.text,
      start: row.start, source: '我的标注', articleId: row.articleId, articleStart: row.articleStart, verified: true });
    const personal = data.contexts.find(context => context.source === '我的标注')!;
    const after = mergeTextbookGlosses(data);
    expect(after.contexts.find(context => context.id === personal.id)).toEqual(personal);
    expect(after.contexts.some(context => context.id === 'textbook5:context:0001')).toBe(false);
    expect(after.cards).toEqual(card); expect(after.reviews).toEqual(reviews); expect(after.readings).toEqual(readings);
    expect(after.contexts.filter(context => context.id.startsWith('textbook5:context:'))).toHaveLength(3756);
  });

  it('backs up the current database, installs once, and does not reapply deleted imported data', () => {
    const path = directory(), old = open(path, false), before = old.read(); old.close();
    const upgraded = open(path), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.contexts.filter(context => context.id.startsWith('textbook5:context:'))).toHaveLength(3757);
    const backup = readdirSync(join(path, 'backups')).find(file => file.startsWith(`before-${TEXTBOOK_GLOSSES_ID}-`))!;
    expect(JSON.parse(readFileSync(join(path, 'backups', backup), 'utf8'))).toEqual(before.data);
    after.data.contexts = after.data.contexts.filter(context => context.id !== 'textbook5:context:0001');
    const saved = upgraded.write(after.data, after.revision); upgraded.close();
    expect(open(path).read()).toEqual(saved);
  });
});
