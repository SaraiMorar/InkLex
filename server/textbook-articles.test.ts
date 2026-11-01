import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import corpus from './content/textbook-articles.json';
import { mergeTextbookArticles, TEXTBOOK_ARTICLES_ID } from './textbook-articles';
import { FileDatabase } from './database';
import { createSeed } from '../src/domain/seed';
import { emptyDatabase } from '../src/domain/model';
import { mergeLegacySnapshot } from '../src/domain/api';

const paths: string[] = [], handles: FileDatabase[] = [];
const directory = () => { const p = mkdtempSync(join(tmpdir(), 'inklex-textbook-')); paths.push(p); return p; };
const open = (path: string, importTextbookArticles = true) => { const h = new FileDatabase(path, { importTextbookArticles, importTextbookGlosses: false }); handles.push(h); return h; };
afterEach(() => {
  for (const h of handles.splice(0)) { try { h.close(); } catch { /* already closed */ } }
  for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('five-volume bookshelf import', () => {
  it('adds 71 supplied texts while preserving stage directions, original parentheses and every vocabulary record', () => {
    const before = createSeed(), after = mergeTextbookArticles(before);
    expect(after.articles).toHaveLength(74);
    expect({ ...after, articles: before.articles }).toEqual(before);
    expect(corpus.articles.filter(a => a.summary.startsWith('必修上册 ·'))).toHaveLength(19);
    expect(corpus.articles.filter(a => a.summary.startsWith('必修下册 ·'))).toHaveLength(17);
    expect(corpus.articles.filter(a => a.summary.startsWith('选择性必修上册 ·'))).toHaveLength(10);
    expect(corpus.articles.filter(a => a.summary.startsWith('选择性必修中册 ·'))).toHaveLength(8);
    expect(corpus.articles.filter(a => a.summary.startsWith('选择性必修下册 ·'))).toHaveLength(17);
    const find = (title: string) => corpus.articles.find(a => a.title === title)!.body;
    expect(find('沁园春·长沙')).toContain('橘子洲头。');
    expect(find('沁园春·长沙')).not.toContain('又名水陆洲');
    expect(find('窦娥冤（节选）')).toContain('（外扮监斩官上，云）');
    expect(find('《论语》十二章')).toContain('（《学而》）');
    expect(find('陈情表')).toContain('外无期功强近之亲');
    expect(find('陈情表').endsWith('谨拜表以闻。')).toBe(true);
    expect(find('陈情表')).toContain('愿陛下矜愍愚诚，听臣微志，庶刘侥幸，保卒余年。');
    expect(find('陈情表')).not.toContain('停止奉养');
    expect(corpus.articles.find(a => a.title === '陈情表')?.summary).toContain('用户补全文');
    expect(find('临安春雨初霁')).toContain('犹及清明可到家。');
    expect(corpus.articles.every(a => !a.body.includes('**') && !a.body.includes('<small>') && !a.sample)).toBe(true);
  });
  it('does not duplicate equivalent texts or overwrite personal edits', () => {
    const data = createSeed(), article = corpus.articles[0];
    data.articles.push({ ...article, id: 'personal-copy' });
    let next = mergeTextbookArticles(data);
    expect(next.articles.filter(a => a.title === article.title)).toHaveLength(1);
    next.articles.find(a => a.id === corpus.articles[1].id)!.body = '我按教材修订过的正文。';
    expect(mergeTextbookArticles(next)).toEqual(next);
    const different = createSeed(); different.articles.push({ ...article, id: 'another-edition', body: '我已有的另一个版本。' });
    next = mergeTextbookArticles(different);
    expect(next.articles.find(a => a.id === 'another-edition')?.body).toBe('我已有的另一个版本。');
    expect(next.articles.filter(a => a.title === article.title)).toHaveLength(2);
  });
  it('backs up the current database and imports only once, keeping later edits and restores', () => {
    const p = directory(), old = open(p, false), original = old.read();
    original.data.settings.dailyNew = 4;
    const before = old.write(original.data, original.revision); old.close();
    const upgraded = open(p), after = upgraded.read();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.articles.length - before.data.articles.length).toBe(71);
    expect({ ...after.data, articles: before.data.articles }).toEqual(before.data);
    const backup = readdirSync(join(p, 'backups')).find(f => f.startsWith(`before-${TEXTBOOK_ARTICLES_ID}-`))!;
    expect(JSON.parse(readFileSync(join(p, 'backups', backup), 'utf8'))).toEqual(before.data);
    after.data.articles.find(a => a.id === corpus.articles[0].id)!.body = '自己的修订。';
    const saved = upgraded.write(after.data, after.revision); upgraded.close();
    const again = open(p); expect(again.read()).toEqual(saved);
    const restored = again.write(emptyDatabase(), saved.revision); again.close();
    expect(open(p).read()).toEqual(restored);
  });
  it('retains the new bookshelf texts during migration from a legacy browser', () => {
    const snapshot = open(directory()).read();
    expect(snapshot.revision).toBe(3); expect(snapshot.pristine).toBe(true);
    const legacy = createSeed(); legacy.settings.dailyNew = 7;
    legacy.articles[0].summary = '我自己的课文笔记';
    const merged = mergeLegacySnapshot(snapshot, legacy);
    expect(merged.articles).toHaveLength(74);
    expect(merged.articles[0]).toEqual(legacy.articles[0]);
    expect(merged.settings.dailyNew).toBe(7);
    expect(merged.contexts).toHaveLength(snapshot.data.contexts.length);
  });
});
