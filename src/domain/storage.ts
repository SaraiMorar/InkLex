import { meaningKey, type Database, validateDatabase } from './model.ts';
import { createSeed } from './seed.ts';

export const STORAGE_KEY = 'inklex.database.v1';
export function readDatabase(storage: Pick<Storage, 'getItem'>): Database {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? createSeed() : parseBackup(raw);
}
export function parseBackup(raw: string): Database {
  if (raw.length > 15_000_000) throw new Error('文件超过 15 MB，请检查是否为 InkLex 备份。');
  try { return validateDatabase(JSON.parse(raw)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('文件不是有效的 JSON 备份。');
    if (error instanceof Error && error.name === 'ZodError') throw new Error('备份格式或版本不受支持，原有数据已保留。');
    throw error;
  }
}
export function writeDatabase(storage: Pick<Storage, 'setItem'>, data: Database) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}
export function exportText(data: Database) { return JSON.stringify(data, null, 2); }

// Merge equivalent content by identity and meaning. Existing review state always wins.
export function mergeBackup(current: Database, incoming: Database): Database {
  const next = structuredClone(current);
  const maps = { article: new Map<string, string>(), entry: new Map<string, string>(), sense: new Map<string, string>(), context: new Map<string, string>() };
  function assertFree<T extends { id: string }>(rows: T[], row: T) {
    if (rows.some(r => r.id === row.id)) throw new Error('备份编号与现有资料冲突。请先导出当前资料，再选择完整恢复。');
  }
  for (const a of incoming.articles) {
    const old = next.articles.find(x => x.title === a.title && x.body === a.body);
    maps.article.set(a.id, old?.id ?? a.id);
    if (!old) { assertFree(next.articles, a); next.articles.push(a); }
  }
  for (const e of incoming.entries) {
    const old = next.entries.find(x => x.word === e.word);
    maps.entry.set(e.id, old?.id ?? e.id);
    if (!old) { assertFree(next.entries, e); next.entries.push(e); }
  }
  for (const s of incoming.senses) {
    const row = { ...s, entryId: maps.entry.get(s.entryId)! };
    const old = next.senses.find(x => x.entryId === row.entryId && meaningKey(x.meaning) === meaningKey(row.meaning));
    maps.sense.set(s.id, old?.id ?? s.id);
    if (!old) { assertFree(next.senses, row); next.senses.push(row); }
  }
  for (const c of incoming.contexts) {
    const row = { ...c, senseId: maps.sense.get(c.senseId)!, articleId: c.articleId ? maps.article.get(c.articleId)! : null };
    const old = next.contexts.find(x => x.senseId === row.senseId && x.text === row.text && x.start === row.start && x.gloss === row.gloss && x.source === row.source && x.articleId === row.articleId && x.articleStart === row.articleStart);
    maps.context.set(c.id, old?.id ?? c.id);
    if (!old) { assertFree(next.contexts, row); next.contexts.push(row); }
  }
  const accepted = new Set<string>();
  for (const [oldId, card] of Object.entries(incoming.cards)) {
    const senseId = maps.sense.get(oldId)!;
    if (!next.cards[senseId]) { next.cards[senseId] = card; accepted.add(oldId); }
  }
  for (const r of incoming.reviews) {
    if ((r.mode === 'practice' || accepted.has(r.senseId)) && !next.reviews.some(x => x.id === r.id)) {
      next.reviews.push({ ...r, senseId: maps.sense.get(r.senseId)!, contextId: maps.context.get(r.contextId)! });
    }
  }
  for (const r of incoming.readings) if (!next.readings.some(x => x.id === r.id)) next.readings.push({ ...r, contextId: maps.context.get(r.contextId)! });
  if (incoming.recitation) {
    next.recitation ??= { questions: [], cards: {}, reviews: [], dailyNew: incoming.recitation.dailyNew };
    const state = next.recitation, questionMap = new Map<string, string>(), compatible = new Set<string>();
    for (const question of incoming.recitation.questions) {
      const old = state.questions.find(row => row.id === question.id || (row.work === question.work && row.prompt === question.prompt && JSON.stringify(row.answers) === JSON.stringify(question.answers)));
      questionMap.set(question.id, old?.id ?? question.id);
      if (!old) state.questions.push({ ...question, articleId: question.articleId ? maps.article.get(question.articleId) ?? null : null });
      if (!old || (old.prompt === question.prompt && JSON.stringify(old.answers) === JSON.stringify(question.answers))) compatible.add(question.id);
    }
    const acceptedCards = new Set<string>();
    for (const [oldId, card] of Object.entries(incoming.recitation.cards)) {
      const questionId = questionMap.get(oldId)!;
      if (compatible.has(oldId) && !state.cards[questionId]) { state.cards[questionId] = card; acceptedCards.add(oldId); }
    }
    for (const review of incoming.recitation.reviews) {
      if (compatible.has(review.questionId) && (review.mode === 'practice' || acceptedCards.has(review.questionId)) && !state.reviews.some(row => row.id === review.id))
        state.reviews.push({ ...review, questionId: questionMap.get(review.questionId)! });
    }
  }
  return validateDatabase(next);
}
