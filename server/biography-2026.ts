import { createHash } from 'node:crypto';
import corpus from './content/biography-2026.json' with { type: 'json' };
import { meaningKey, sentenceAt, validateDatabase, type Database } from '../src/domain/model.ts';

export const BIOGRAPHY_2026_ID = corpus.id;
export const biography2026Stats = corpus.stats;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function mergeBiography2026(current: Database): Database {
  const data = structuredClone(current);
  const entries = new Map(data.entries.map(entry => [entry.word, entry]));
  const senses = new Map(data.senses.map(sense => [JSON.stringify([sense.entryId, meaningKey(sense.meaning)]), sense]));
  for (const incoming of corpus.articles) {
    let article = data.articles.find(row => row.id === incoming.id);
    if (!article) {
      article = {
        id: incoming.id, title: incoming.title, author: incoming.author, era: incoming.era,
        body: incoming.body, summary: incoming.summary, sample: false, collection: 'extracurricular',
        translations: incoming.translations,
      };
      data.articles.push(article);
    }
    for (const row of incoming.glosses) {
      const contextId = `biography2026:context:${row.ref}`;
      if (data.contexts.some(context => context.id === contextId)) continue;
      if (article.body.slice(row.articleStart, row.articleStart + row.word.length) !== row.word) throw new Error(`${row.ref} 的原文标注位置错误。`);
      const sentence = sentenceAt(article.body, row.articleStart);
      let entry = entries.get(row.word);
      if (!entry) {
        entry = { id: `biography2026:entry:${hash(row.word)}`, word: row.word };
        entries.set(row.word, entry); data.entries.push(entry);
      }
      const senseKey = JSON.stringify([entry.id, meaningKey(row.meaning)]);
      let sense = senses.get(senseKey);
      if (!sense) {
        sense = { id: `biography2026:sense:${hash(senseKey)}`, entryId: entry.id, meaning: row.meaning,
          note: '资料：2026 上海高三一模传记文言实词梳理。' };
        senses.set(senseKey, sense); data.senses.push(sense);
      }
      data.contexts.push({
        id: contextId, senseId: sense.id, text: sentence.text, start: sentence.start,
        gloss: row.meaning, source: `《${article.title}》 · 2026一模${incoming.district}区`,
        articleId: article.id, articleStart: row.articleStart, verified: true, learned: false,
      });
    }
  }
  return validateDatabase(data);
}
