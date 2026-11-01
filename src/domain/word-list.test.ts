import { expect, it } from 'vitest';
import { createSeed } from './seed';
import { enroll, gradeContext } from './scheduler';
import { sortWordRows, wordRows } from './word-list';

it('groups review activity by word and puts unscheduled words after the earliest eligible review', async () => {
  let data = createSeed();
  const [first, second] = data.contexts.filter(c => c.verified);
  const now = new Date('2026-11-01T01:00:00Z');
  data = await enroll(data, [first.senseId, second.senseId], now);
  data = await gradeContext(data, first.id, 1, 'scheduled', now);
  data = await gradeContext(data, second.id, 3, 'scheduled', now);
  data = await gradeContext(data, first.id, 1, 'practice', now);
  const before = structuredClone(data), rows = wordRows(data);
  const firstWord = data.senses.find(s => s.id === first.senseId)!.entryId;
  expect(sortWordRows(rows, 'due')[0].entry.id).toBe(firstWord);
  expect(sortWordRows(rows, 'forgotten')[0].entry.id).toBe(firstWord);
  expect(rows.find(r => r.entry.id === firstWord)!.forgotten).toBe(2);
  expect(sortWordRows(rows, 'due').at(-1)!.due).toBe(Infinity);
  expect(sortWordRows(rows, 'default').map(r => r.entry)).toEqual(data.entries);
  expect(data).toEqual(before);
  // A pending context cannot supply an eligible due time.
  data.contexts.forEach(c => { if (c.senseId === first.senseId) c.verified = false; });
  expect(wordRows(data).find(r => r.entry.id === firstWord)!.due).toBe(Infinity);
});
