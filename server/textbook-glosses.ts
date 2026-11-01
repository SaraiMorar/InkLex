import { createHash } from 'node:crypto';
import corpus from './content/textbook-glosses.json' with { type: 'json' };
import { meaningKey, validateDatabase, type Database } from '../src/domain/model.ts';

export const TEXTBOOK_GLOSSES_ID = corpus.id;
export const textbookGlossStats = corpus.stats;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function mergeTextbookGlosses(current: Database): Database {
  const data = structuredClone(current);
  for (const article of data.articles) {
    if (article.id.startsWith('textbook5:article:') && article.summary.includes('字词待整理')) {
      article.summary = article.summary.replace('字词待整理', '已关联字词释义');
    }
  }
  const articles = new Map(data.articles.map(article => [article.id, article]));
  const entries = new Map(data.entries.map(entry => [entry.word, entry]));
  const senses = new Map(data.senses.map(sense => [JSON.stringify([sense.entryId, meaningKey(sense.meaning)]), sense]));
  const ranges = new Map<string, { start: number; end: number }[]>();
  const wordBySense = new Map(data.senses.map(sense => [sense.id, data.entries.find(entry => entry.id === sense.entryId)?.word ?? '']));
  for (const context of data.contexts) {
    if (!context.verified || !context.articleId || context.articleStart === null) continue;
    const word = wordBySense.get(context.senseId) ?? '';
    const articleRanges = ranges.get(context.articleId) ?? [];
    articleRanges.push({ start: context.articleStart, end: context.articleStart + word.length });
    ranges.set(context.articleId, articleRanges);
  }
  for (const row of corpus.records) {
    if (data.contexts.some(context => context.id === `textbook5:context:${row.ref}`)) continue;
    const article = articles.get(row.articleId);
    if (!article || article.body.slice(row.articleStart, row.articleStart + row.word.length) !== row.word
      || article.body.slice(row.articleStart - row.start, row.articleStart - row.start + row.text.length) !== row.text) continue;
    const articleRanges = ranges.get(row.articleId) ?? [];
    const end = row.articleStart + row.word.length;
    if (articleRanges.some(range => row.articleStart < range.end && end > range.start)) continue;
    let entry = entries.get(row.word);
    if (!entry) {
      entry = { id: `textbook5:entry:${hash(row.word)}`, word: row.word };
      entries.set(row.word, entry); data.entries.push(entry);
    }
    const senseKey = JSON.stringify([entry.id, meaningKey(row.meaning)]);
    let sense = senses.get(senseKey);
    if (!sense) {
      sense = { id: `textbook5:sense:${hash(senseKey)}`, entryId: entry.id, meaning: row.meaning,
        note: '资料：高中语文五册教材随文释义。' };
      senses.set(senseKey, sense); data.senses.push(sense);
      wordBySense.set(sense.id, row.word);
    }
    data.contexts.push({
      id: `textbook5:context:${row.ref}`, senseId: sense.id, text: row.text, start: row.start,
      gloss: row.meaning, source: `${row.source} · 教材随文释义`, articleId: row.articleId,
      articleStart: row.articleStart, verified: true, learned: false,
    });
    articleRanges.push({ start: row.articleStart, end }); ranges.set(row.articleId, articleRanges);
  }
  return validateDatabase(data);
}
