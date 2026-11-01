import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/domain/seed';
import { meaningKey, validateDatabase, type Database } from '../src/domain/model';
import { enroll } from '../src/domain/scheduler';
import { mergeSenseCleanup } from './sense-cleanup';

function addSense(data: Database, word: string, id: string, meaning: string, text: string, start: number, gloss = meaning) {
  let entry = data.entries.find(row => row.word === word);
  if (!entry) { entry = { id: `entry-${word}`, word }; data.entries.push(entry); }
  data.senses.push({ id, entryId: entry.id, meaning, note: `来源 ${id}` });
  data.contexts.push({ id: `context-${id}`, senseId: id, text, start, gloss, source: `资料 ${id}`,
    articleId: null, articleStart: null, verified: true, learned: false });
}

describe('sense normalization and controlled cleanup', () => {
  it('recognizes punctuation and synonym-order variants without treating containment as automatic equality', () => {
    expect(meaningKey('兼并，吞并')).toBe(meaningKey('吞并、兼并'));
    expect(meaningKey('通“背”，背向')).toBe(meaningKey('通"背"；背向'));
    expect(meaningKey('背叛')).not.toBe(meaningKey('违背，背叛'));
  });

  it('merges safe variants, preserves every source gloss, and explicitly joins the reviewed 背 senses', async () => {
    let data = createSeed();
    addSense(data, '并', 'gaosan300:sense:并', '兼并，吞并', '行将为人所并。', 5);
    addSense(data, '并', 'textbook5:sense:并', '吞并，兼并', '并吞八荒之心。', 0);
    addSense(data, '并', 'gaosan300:sense:合并', '合，合并', '并力西向。', 0);
    addSense(data, '并', 'textbook5:sense:合', '合', '并力逆操。', 0);
    addSense(data, '背', 'gaosan300:sense:背', '违背，背叛', '不敢背项王也。', 2);
    addSense(data, '背', 'textbook5:sense:背', '背叛', '皆背晋以归梁。', 1, '背叛');
    data = await enroll(validateDatabase(data), ['textbook5:sense:并', 'textbook5:sense:背'], new Date('2026-11-01T00:00:00Z'));
    const after = mergeSenseCleanup(data);
    const senses = (word: string) => {
      const entry = after.entries.find(row => row.word === word)!;
      return after.senses.filter(sense => sense.entryId === entry.id);
    };
    expect(senses('背')).toHaveLength(1);
    expect(senses('背')[0].meaning).toBe('违背，背叛');
    expect(senses('并')).toHaveLength(2);
    expect(senses('并').map(sense => sense.meaning).sort()).toEqual(['合，合并', '吞并，兼并']);
    const annex = senses('并').find(sense => sense.meaning === '吞并，兼并')!;
    expect(after.contexts.filter(context => context.senseId === annex.id).map(context => context.gloss))
      .toEqual(['兼并，吞并', '吞并，兼并']);
    expect(after.contexts.filter(context => context.senseId === senses('背')[0].id).map(context => context.gloss))
      .toEqual(['违背，背叛', '背叛']);
    expect(after.cards[annex.id]).toBeDefined();
    expect(after.cards[senses('背')[0].id]).toBeDefined();
    expect(mergeSenseCleanup(after)).toEqual(after);
    expect(validateDatabase(after)).toEqual(after);
  });
});
