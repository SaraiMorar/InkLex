import { createHash } from 'node:crypto';
import corpus from './content/supplement.json' with { type: 'json' };
import { meaningKey, validateDatabase, type Database } from '../src/domain/model.ts';
export const SUPPLEMENT_ID = corpus.id;
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const normalized = (s: string) => s.replace(/\s/g, '').replace(/[。；;，,]+$/, '');
export function mergeSupplement(current: Database): Database {
  const data = structuredClone(current);
  const words = new Map(data.entries.map(e => [e.word, e]));
  const senses = new Map(data.senses.map(s => [JSON.stringify([s.entryId, meaningKey(s.meaning)]), s]));
  const contexts = new Set(data.contexts.map(c => JSON.stringify([c.senseId, normalized(c.text), c.start, normalized(c.gloss)])));
  for (const row of corpus.records) {
    let entry = words.get(row.word);
    if (!entry) { entry = { id: `supplement:entry:${hash(row.word)}`, word: row.word }; words.set(row.word, entry); data.entries.push(entry); }
    const key = JSON.stringify([entry.id, meaningKey(row.meaning)]);
    let sense = senses.get(key);
    if (!sense) {
      sense = { id: `supplement:sense:${hash(key)}`, entryId: entry.id, meaning: row.meaning, note: `资料：${row.pack}。${row.note}` };
      senses.set(key, sense); data.senses.push(sense);
    }
    const duplicate = JSON.stringify([sense.id, normalized(row.text), row.start, normalized(row.meaning)]);
    // A questionable source remains separately reviewable; it never downgrades a personal example.
    if (!row.issue && contexts.has(duplicate)) continue;
    const id = `supplement:context:${row.pack}:${row.ref}`;
    if (data.contexts.some(c => c.id === id)) continue;
    if (row.issue) {
      const note = `\n待核对 ${row.pack}:${row.ref}：${row.issue}`;
      if (sense.note.length + note.length <= 3000 && !sense.note.includes(note)) sense.note += note;
    }
    data.contexts.push({ id, senseId: sense.id, text: row.text, start: row.start, gloss: row.meaning,
      source: `${row.source || '原资料未标出处'} · ${row.pack}:${row.ref}`,
      articleId: null, articleStart: null, verified: !row.issue, learned: false });
    contexts.add(duplicate);
  }
  return validateDatabase(data);
}
