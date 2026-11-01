import type { Context, Database, Entry, Sense } from './model';

export const wordSorts = [
  ['default', '默认顺序'], ['pinyin', '拼音 A → Z'], ['pinyin-desc', '拼音 Z → A'],
  ['senses', '义项最多'], ['contexts', '例句最多'], ['due', '复习时间最早'], ['forgotten', '忘记次数最多'],
] as const;
export type WordSort = typeof wordSorts[number][0];
export type WordRow = { entry: Entry; senses: Sense[]; contexts: Context[]; sources: string[]; forgotten: number; due: number; planned: boolean };
const collator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true });

export function wordRows(data: Database): WordRow[] {
  const rows = data.entries.map(entry => ({ entry, senses: [], contexts: [], sources: [], forgotten: 0, due: Infinity, planned: false }) as WordRow);
  const byEntry = new Map(rows.map(row => [row.entry.id, row]));
  const bySense = new Map<string, WordRow>();
  for (const sense of data.senses) {
    const row = byEntry.get(sense.entryId);
    if (!row) continue;
    row.senses.push(sense); bySense.set(sense.id, row);
    row.planned ||= !!data.cards[sense.id];
  }
  for (const context of data.contexts) {
    const row = bySense.get(context.senseId);
    if (!row) continue;
    row.contexts.push(context);
    const card = data.cards[context.senseId];
    if (context.verified && card && card.state !== 0) row.due = Math.min(row.due, Date.parse(card.dueAt));
  }
  for (const review of data.reviews) {
    const row = bySense.get(review.senseId);
    if (row && review.grade === 1) row.forgotten++;
  }
  for (const row of rows) row.sources = [...new Set(row.contexts.map(c => c.source).filter(Boolean))];
  return rows;
}

export function sortWordRows(rows: WordRow[], sort: WordSort): WordRow[] {
  if (sort === 'default') return rows.slice();
  return rows.slice().sort((a, b) => {
    const alphabetic = collator.compare(a.entry.word, b.entry.word);
    if (sort === 'pinyin') return alphabetic;
    if (sort === 'pinyin-desc') return -alphabetic;
    const difference = sort === 'senses' ? b.senses.length - a.senses.length
      : sort === 'contexts' ? b.contexts.length - a.contexts.length
      : sort === 'forgotten' ? b.forgotten - a.forgotten
      : a.due === b.due ? 0 : a.due < b.due ? -1 : 1;
    return difference || alphabetic;
  });
}
