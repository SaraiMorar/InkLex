import { createHash } from 'node:crypto';
import corpus from './content/biography-2025.json' with { type: 'json' };
import { getWord, meaningKey, sentenceAt, validateDatabase, type Database } from '../src/domain/model.ts';

export const BIOGRAPHY_2025_ID = corpus.id;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
function characters(body: string) {
  let offset = 0;
  const positions: { start: number; end: number }[] = [], letters: string[] = [];
  for (const char of body) {
    if (/[\p{L}\p{N}]/u.test(char) && !/[①-⑳㉑-㊿]/u.test(char)) {
      letters.push(char); positions.push({ start: offset, end: offset + char.length });
    }
    offset += char.length;
  }
  return { text: letters.join(''), positions };
}

export function mergeBiography2025(current: Database): Database {
  const data = structuredClone(current);
  const entries = new Map(data.entries.map(e => [e.word, e]));
  const senses = new Map(data.senses.map(s => [JSON.stringify([s.entryId, meaningKey(s.meaning)]), s]));
  for (const incoming of corpus.articles) {
    const source = characters(incoming.body);
    let article = data.articles.find(a => a.id === incoming.id) ?? data.articles.find(a => {
      const text = characters(a.body).text, at = text.indexOf(source.text);
      return at >= 0 && text.indexOf(source.text, at + 1) < 0;
    });
    if (!article) {
      article = { id: incoming.id, title: incoming.title, author: incoming.author, era: incoming.era,
        body: incoming.body, summary: incoming.summary, sample: false, collection: 'extracurricular', translations: [] };
      data.articles.push(article);
    }
    const target = characters(article.body), at = target.text.indexOf(source.text);
    if (at < 0 || target.text.indexOf(source.text, at + 1) >= 0) continue;
    const base = [...target.text.slice(0, at)].length;
    const project = (start: number, length: number) => {
      const first = source.positions.findIndex(p => p.end > start);
      let last = first;
      while (last + 1 < source.positions.length && source.positions[last + 1].start < start + length) last++;
      // Preserve source punctuation at the edges when the body is identical.
      return article.body === incoming.body ? { start, end: start + length }
        : { start: target.positions[base + first].start, end: target.positions[base + last].end };
    };
    for (const row of incoming.translations) {
      const { start, end } = project(row.articleStart, row.source.length);
      const translations = article.translations ?? [];
      if (translations.some(t => t.id === row.id || (t.articleStart < end && t.articleStart + t.source.length > start))) continue;
      article.translations = [...translations, { ...row, articleStart: start, source: article.body.slice(start, end) }]
        .sort((a, b) => a.articleStart - b.articleStart);
    }
    for (const row of incoming.glosses) {
      const id = `biography2025:context:${row.ref}`;
      if (data.contexts.some(c => c.id === id)) continue;
      const { start, end } = project(row.articleStart, row.word.length);
      if (article.body.slice(start, end) !== row.word || data.contexts.some(c => c.articleId === article.id
        && c.articleStart !== null && c.articleStart < end && c.articleStart + getWord(data, c.senseId).length > start)) continue;
      let entry = entries.get(row.word);
      if (!entry) {
        entry = { id: `biography2025:entry:${hash(row.word)}`, word: row.word };
        entries.set(row.word, entry); data.entries.push(entry);
      }
      const key = JSON.stringify([entry.id, meaningKey(row.meaning)]);
      let sense = senses.get(key);
      if (!sense) {
        sense = { id: `biography2025:sense:${hash(key)}`, entryId: entry.id, meaning: row.meaning,
          note: '资料：2025 上海高三二模传记文言实词梳理。保留资料原释义。' };
        senses.set(key, sense); data.senses.push(sense);
      }
      const sentence = sentenceAt(article.body, start);
      data.contexts.push({ id, senseId: sense.id, text: sentence.text, start: sentence.start, gloss: row.meaning,
        source: `《${article.title}》 · 2025二模${incoming.district}区`, articleId: article.id,
        articleStart: start, verified: true, learned: false });
    }
  }
  return validateDatabase(data);
}
