import { createHash } from 'node:crypto';
import corpus from './content/beikao-2027.json' with { type: 'json' };
import { getWord, meaningKey, sentenceAt, validateDatabase, type Database } from '../src/domain/model.ts';

export const BEIKAO_2027_ID = corpus.id;
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
const normalized = (value: string) => value.replace(/\s/g, '').replace(/[。；;，,]+$/, '');

export function mergeBeikao2027(current: Database): Database {
  const data = structuredClone(current);
  const entries = new Map(data.entries.map(entry => [entry.word, entry]));
  const senses = new Map(data.senses.map(sense => [JSON.stringify([sense.entryId, meaningKey(sense.meaning)]), sense]));
  const seenExamples = new Set(data.contexts.map(context =>
    JSON.stringify([context.senseId, normalized(context.text), context.start, normalized(context.gloss)])));
  for (const incoming of corpus.articles) {
    const source = characters(incoming.body);
    let article = data.articles.find(row => row.id === incoming.id) ?? data.articles.find(row => {
      const text = characters(row.body).text, at = text.indexOf(source.text);
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
      const first = source.positions.findIndex(position => position.end > start);
      let last = first;
      while (last + 1 < source.positions.length && source.positions[last + 1].start < start + length) last++;
      // Preserve source punctuation at the edges when the body is identical.
      return article.body === incoming.body ? { start, end: start + length }
        : { start: target.positions[base + first].start, end: target.positions[base + last].end };
    };
    // The lexicon shares every gloss's entry and sense; standalone textbook
    // examples attach to that sense even when the in-article slot was taken.
    const senseByRef = new Map<string, string>();
    for (const row of incoming.glosses) {
      let entry = entries.get(row.word);
      if (!entry) {
        entry = { id: `beikao2027:entry:${hash(row.word)}`, word: row.word };
        entries.set(row.word, entry); data.entries.push(entry);
      }
      const key = JSON.stringify([entry.id, meaningKey(row.meaning)]);
      let sense = senses.get(key);
      if (!sense) {
        sense = { id: `beikao2027:sense:${hash(key)}`, entryId: entry.id, meaning: row.meaning,
          note: '资料：2027高考备考课外文言材料。保留资料原释义。' };
        senses.set(key, sense); data.senses.push(sense);
      }
      senseByRef.set(row.ref, sense.id);
    }
    for (const row of incoming.translations) {
      const { start, end } = project(row.articleStart, row.source.length);
      const translations = article.translations ?? [];
      if (translations.some(existing => existing.id === row.id
        || (existing.articleStart < end && existing.articleStart + existing.source.length > start))) continue;
      article.translations = [...translations, { ...row, articleStart: start, source: article.body.slice(start, end) }]
        .sort((a, b) => a.articleStart - b.articleStart);
    }
    for (const row of incoming.glosses) {
      const id = `beikao2027:context:${row.ref}`;
      if (data.contexts.some(context => context.id === id)) continue;
      const { start, end } = project(row.articleStart, row.word.length);
      if (article.body.slice(start, end) !== row.word || data.contexts.some(context => context.articleId === article.id
        && context.articleStart !== null && context.articleStart < end
        && context.articleStart + getWord(data, context.senseId).length > start)) continue;
      const sentence = sentenceAt(article.body, start);
      data.contexts.push({ id, senseId: senseByRef.get(row.ref)!, text: sentence.text, start: sentence.start,
        gloss: row.meaning, source: `《${article.title}》 · 2027备考`, articleId: article.id,
        articleStart: start, verified: true, learned: false });
    }
    incoming.lexiconExamples.forEach((row, index) => {
      const senseId = senseByRef.get(row.ref);
      if (!senseId || !row.text) return;
      const id = `beikao2027:context:${row.ref}:ex${index + 1}`;
      if (data.contexts.some(context => context.id === id)) return;
      const gloss = data.senses.find(sense => sense.id === senseId)!.meaning;
      const duplicate = JSON.stringify([senseId, normalized(row.text), row.start, normalized(gloss)]);
      // A questionable source stays separately reviewable; it never downgrades a personal example.
      if (!row.issue && seenExamples.has(duplicate)) return;
      const sense = data.senses.find(candidate => candidate.id === senseId)!;
      if (row.issue) {
        const note = `\n待核对 2027备考:${row.ref}：${row.issue}`;
        if (sense.note.length + note.length <= 3000 && !sense.note.includes(note)) sense.note += note;
      }
      seenExamples.add(duplicate);
      data.contexts.push({ id, senseId, text: row.text, start: row.start,
        gloss, source: row.source === '成语' ? `成语 · ${row.ref}` : `《${row.source || '原资料未标出处'}》 · ${row.ref}`,
        articleId: null, articleStart: null, verified: !row.issue, learned: false });
    });
  }
  return validateDatabase(data);
}
