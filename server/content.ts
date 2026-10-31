import { createHash } from 'node:crypto';
import corpus from './content/gaosan-300.json' with { type: 'json' };
import { emptyDatabase, validateDatabase, type Database } from '../src/domain/model.ts';
import { mergeBackup } from '../src/domain/storage.ts';
import { GAOSAN_CONTEXT_PREFIX } from '../src/domain/bundles.ts';

export const CONTENT_ID = corpus.id;
export const contentStats = corpus.stats;
interface RecordRow {
  ref: string; word: string; partOfSpeech: string; meaning: string; text: string;
  source: string; original: string; start: number; verified: boolean;
  issue?: string; editorialNote?: string;
}
const records: RecordRow[] = corpus.records;
const stableId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function createBundledContent(): Database {
  const data = emptyDatabase();
  const entries = new Map<string, Database['entries'][number]>();
  const senses = new Map<string, Database['senses'][number]>();
  for (const row of records) {
    let entry = entries.get(row.word);
    if (!entry) {
      entry = { id: `gaosan300:entry:${row.word}`, word: row.word };
      entries.set(row.word, entry); data.entries.push(entry);
    }
    const key = JSON.stringify([row.word, row.meaning]);
    let sense = senses.get(key);
    if (!sense) {
      sense = { id: `gaosan300:sense:${stableId(key)}`, entryId: entry.id, meaning: row.meaning,
        note: `词性（原资料）：${row.partOfSpeech}。收录自《${corpus.title}》。` };
      senses.set(key, sense); data.senses.push(sense);
    }
    const annotation = row.issue || row.editorialNote;
    if (annotation) sense.note += `\n${row.issue ? '待核对' : '校录'} ${row.ref}：${annotation}`;
    if (row.issue && row.text + row.source !== row.original) sense.note += ` 原资料：${row.original}`;
    data.contexts.push({ id: `${GAOSAN_CONTEXT_PREFIX}${row.ref}`, senseId: sense.id,
      text: row.text, start: row.start, gloss: row.meaning,
      source: `${row.source} · 高三300实词 ${row.ref}`,
      articleId: null, articleStart: null, verified: row.verified, learned: false });
  }
  return validateDatabase(data);
}

export function mergeBundledContent(current: Database): Database {
  const incoming = createBundledContent();
  const next = mergeBackup(current, incoming);
  // Preserve personal notes, while keeping source cautions visible on shared senses.
  const words = new Map(next.entries.map(entry => [entry.word, entry.id]));
  for (const sense of incoming.senses) {
    const word = incoming.entries.find(entry => entry.id === sense.entryId)!.word;
    const target = next.senses.find(row => row.entryId === words.get(word) && row.meaning === sense.meaning)!;
    if (!target.note.includes(sense.note)) {
      const note = [target.note, sense.note].filter(Boolean).join('\n');
      if (note.length <= 3000) target.note = note;
    }
  }
  return validateDatabase(next);
}
