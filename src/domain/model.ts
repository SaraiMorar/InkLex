import { z } from 'zod';

const id = z.string().min(1).max(150);
const date = z.iso.datetime();
const text = z.string().min(1).max(100000);
export const articleTranslationSchema = z.object({
  id, articleStart: z.number().int().nonnegative(), source: text,
  translation: z.string().min(1).max(100000),
});
export const articleSchema = z.object({
  id, title: z.string().min(1).max(120), author: z.string().max(80), era: z.string().max(40),
  body: text, summary: z.string().max(300), sample: z.boolean(),
  collection: z.enum(['curricular', 'extracurricular']).optional(),
  translations: z.array(articleTranslationSchema).max(5000).optional(),
});
export const entrySchema = z.object({ id, word: z.string().min(1).max(40) });
export const senseSchema = z.object({ id, entryId: id, meaning: z.string().min(1).max(1000), note: z.string().max(3000) });
export const contextSchema = z.object({
  id, senseId: id, text, start: z.number().int().nonnegative(),
  gloss: z.string().min(1).max(1000), source: z.string().max(160),
  articleId: id.nullable(), articleStart: z.number().int().nonnegative().nullable(),
  verified: z.boolean(), learned: z.boolean(),
});
export const cardSchema = z.object({
  cardId: z.string(), dueAt: date, lastReviewAt: date.nullable(),
  stability: z.number().finite().nonnegative(), difficulty: z.number().finite().min(0).max(10),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  scheduleStatus: z.enum(['new', 'learning', 'review']),
  reps: z.number().int().nonnegative(), lapses: z.number().int().nonnegative(),
  scheduledDays: z.number().nonnegative(), learningStep: z.number().int().nonnegative(),
});
const reviewSchema = z.object({
  id, senseId: id, contextId: id, time: date, mode: z.enum(['scheduled', 'practice']),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  before: cardSchema.nullable(), after: cardSchema.nullable(),
  retention: z.number().min(0.7).max(0.97),
  nativeLog: z.record(z.string(), z.unknown()).nullable(),
});
export const recitationQuestionSchema = z.object({
  id, work: z.string().min(1).max(120), author: z.string().max(80), number: z.number().int().positive(),
  prompt: z.string().min(1).max(5000), answers: z.array(z.string().min(1).max(2000)).min(1).max(16),
  alternatives: z.array(z.array(z.string().min(1).max(2000))).max(16).optional(),
  alternativeSets: z.array(z.array(z.string().min(1).max(2000)).min(1).max(16)).max(16).optional(),
  note: z.string().max(3000), source: z.string().max(160), articleId: id.nullable(),
});
const recitationReviewSchema = reviewSchema.omit({ senseId: true, contextId: true }).extend({
  questionId: id, responses: z.array(z.string().max(2000)).max(16),
});
const recitationSchema = z.object({
  questions: z.array(recitationQuestionSchema).max(50000),
  cards: z.record(z.string(), cardSchema), reviews: z.array(recitationReviewSchema).max(500000),
  dailyNew: z.number().int().min(0).max(100),
});
export const databaseSchema = z.object({
  version: z.literal(1), algorithm: z.literal('ts-fsrs@6.0.0/FSRS-6'),
  articles: z.array(articleSchema).max(10000), entries: z.array(entrySchema).max(50000),
  senses: z.array(senseSchema).max(100000), contexts: z.array(contextSchema).max(100000),
  cards: z.record(z.string(), cardSchema), reviews: z.array(reviewSchema).max(500000),
  readings: z.array(z.object({ id, contextId: id, time: date })).max(500000),
  settings: z.object({ dailyNew: z.number().int().min(0).max(100), retention: z.number().min(0.7).max(0.97) }),
  recitation: recitationSchema.optional(),
});

export type Article = z.infer<typeof articleSchema>;
export type ArticleCollection = 'curricular' | 'extracurricular';
// Old backups have no collection field. Keep the three original texts in their
// requested shelf without changing their IDs or any linked study records.
export function articleCollection(article: Article): ArticleCollection {
  return article.collection ?? (['sample-xiaoshitan', 'sample-loushi', 'sample-ailian'].includes(article.id) ? 'extracurricular' : 'curricular');
}
export type Entry = z.infer<typeof entrySchema>;
export type Sense = z.infer<typeof senseSchema>;
export type Context = z.infer<typeof contextSchema>;
export type StoredCard = z.infer<typeof cardSchema>;
export type Database = z.infer<typeof databaseSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type RecitationQuestion = z.infer<typeof recitationQuestionSchema>;
export type RecitationState = z.infer<typeof recitationSchema>;
export type Grade = Review['grade'];
export const uid = () => crypto.randomUUID();
// Equivalent source glosses often differ only in punctuation or synonym order.
// Keep the original wording on Context.gloss, while using this key to share one
// schedulable sense. Do not use containment here: “背叛” and “违背，背叛”
// require an explicit editorial decision.
export function meaningKey(value: string) {
  const cleaned = value.normalize('NFKC').trim()
    .replace(/^\d{1,3}[.、．:：]?\s*/u, '')
    .replace(/[“”‘’"'()（）\s]/gu, '')
    .replace(/[。；;,，、]+$/u, '');
  return [...new Set(cleaned.split(/[，,、；;]/u).filter(Boolean))].sort().join('\u0001');
}
export const emptyDatabase = (): Database => ({
  version: 1, algorithm: 'ts-fsrs@6.0.0/FSRS-6', articles: [], entries: [], senses: [], contexts: [],
  cards: {}, reviews: [], readings: [], settings: { dailyNew: 10, retention: 0.9 },
});

export function validateDatabase(input: unknown): Database {
  const data = databaseSchema.parse(input);
  for (const rows of [data.articles, data.entries, data.senses, data.contexts, data.reviews, data.readings]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('备份含有重复编号。');
  }
  const entries = new Map(data.entries.map(e => [e.id, e]));
  const senses = new Map(data.senses.map(s => [s.id, s]));
  const articles = new Map(data.articles.map(a => [a.id, a]));
  const contexts = new Map(data.contexts.map(c => [c.id, c]));
  if (new Set(data.entries.map(e => e.word)).size !== data.entries.length) throw new Error('备份含有重复词条。');
  for (const sense of data.senses) if (!entries.has(sense.entryId)) throw new Error('义项缺少对应词条。');
  if (new Set(data.senses.map(s => JSON.stringify([s.entryId, s.meaning]))).size !== data.senses.length) throw new Error('备份含有重复义项。');
  for (const context of data.contexts) {
    const sense = senses.get(context.senseId);
    const word = sense && entries.get(sense.entryId)?.word;
    if (!word || context.text.slice(context.start, context.start + word.length) !== word) throw new Error('例句中的标注位置不正确。');
    if (context.articleId !== null) {
      const article = articles.get(context.articleId);
      if (!article) throw new Error('标注缺少对应课文。');
      if (context.verified && (context.articleStart === null || article.body.slice(context.articleStart, context.articleStart + word.length) !== word || article.body.slice(context.articleStart - context.start, context.articleStart - context.start + context.text.length) !== context.text)) {
        throw new Error('课文标注与原文不匹配，请重新核对位置。');
      }
    } else if (context.articleStart !== null) throw new Error('零散例句含有无效的课文位置。');
  }
  for (const article of data.articles) {
    const translations = article.translations ?? [];
    if (new Set(translations.map(row => row.id)).size !== translations.length) throw new Error('课文含有重复的译文编号。');
    for (const row of translations) {
      if (article.body.slice(row.articleStart, row.articleStart + row.source.length) !== row.source) throw new Error('逐句译文与原文位置不匹配。');
    }
    const translationRanges = translations.map(row => ({ start: row.articleStart, end: row.articleStart + row.source.length })).sort((a, b) => a.start - b.start);
    if (translationRanges.some((range, i) => i > 0 && range.start < translationRanges[i - 1].end)) throw new Error('课文中的逐句译文范围重叠。');
    const ranges = data.contexts.filter(c => c.articleId === article.id && c.verified)
      .map(c => ({ start: c.articleStart!, end: c.articleStart! + entries.get(senses.get(c.senseId)!.entryId)!.word.length }))
      .sort((a, b) => a.start - b.start);
    if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) throw new Error('课文中的标注位置重叠。');
  }
  for (const [senseId, card] of Object.entries(data.cards)) {
    if (!senses.has(senseId)) throw new Error('复习卡片缺少对应义项。');
    if (card.lastReviewAt && new Date(card.dueAt) < new Date(card.lastReviewAt)) throw new Error('复习到期时间早于评分时间。');
    if (card.state !== 0 && (!card.lastReviewAt || card.stability <= 0)) throw new Error('复习状态不完整。');
  }
  for (const review of data.reviews) {
    // Contexts may be reassigned when an explanation is corrected; historical IDs remain intact.
    if (!senses.has(review.senseId) || !contexts.has(review.contextId)) throw new Error('复习记录的关联内容缺失。');
    if (review.mode === 'scheduled' && (!review.before || !review.after)) throw new Error('正式复习记录缺少记忆状态。');
  }
  for (const reading of data.readings) if (!contexts.has(reading.contextId)) throw new Error('阅读记录的关联内容缺失。');
  if (data.recitation) {
    const state = data.recitation, questionIds = new Set(state.questions.map(row => row.id));
    if (questionIds.size !== state.questions.length || new Set(state.reviews.map(row => row.id)).size !== state.reviews.length) throw new Error('默写资料含有重复编号。');
    for (const question of state.questions) {
      if (question.alternatives && question.alternatives.length !== question.answers.length) throw new Error('默写题的备选答案数量不匹配。');
      if (question.alternativeSets?.some(set => set.length !== question.answers.length)) throw new Error('默写题的备选答案组数量不匹配。');
    }
    for (const [questionId, card] of Object.entries(state.cards)) {
      if (!questionIds.has(questionId)) throw new Error('默写卡片的题目缺失。');
      if (card.lastReviewAt && new Date(card.dueAt) < new Date(card.lastReviewAt)) throw new Error('默写到期时间早于评分时间。');
      if (card.state !== 0 && (!card.lastReviewAt || card.stability <= 0)) throw new Error('默写复习状态不完整。');
    }
    for (const review of state.reviews) {
      if (!questionIds.has(review.questionId)) throw new Error('默写记录的题目缺失。');
      if (review.mode === 'scheduled' && (!review.before || !review.after)) throw new Error('默写复习记录缺少记忆状态。');
    }
  }
  return data;
}

export function getWord(data: Database, senseId: string) {
  const sense = data.senses.find(s => s.id === senseId);
  return data.entries.find(e => e.id === sense?.entryId)?.word ?? '';
}
export function contextsFor(data: Database, senseId: string, articleIds: string[] = []) {
  return data.contexts.filter(c => c.senseId === senseId && c.verified && (!articleIds.length || (c.articleId && articleIds.includes(c.articleId))));
}
export function occurrences(text: string, word: string): number[] {
  if (!word) return [];
  const result: number[] = [];
  for (let p = text.indexOf(word); p !== -1; p = text.indexOf(word, p + word.length)) result.push(p);
  return result;
}
export function sentenceAt(body: string, position: number) {
  let start = position, end = position;
  while (start > 0 && !/[。！？\n]/.test(body[start - 1])) start--;
  while (end < body.length && !/[。！？\n]/.test(body[end])) end++;
  if (end < body.length && body[end] !== '\n') end++;
  return { text: body.slice(start, end), start: position - start };
}
export function articleSentences(body: string) {
  const result: { articleStart: number; source: string }[] = [];
  let start = 0;
  for (const match of body.matchAll(/[。！？](?:[”’』】])?/gu)) {
    const end = match.index + match[0].length;
    const raw = body.slice(start, end);
    const leading = raw.length - raw.replace(/^\n+/u, '').length;
    if (raw.trim()) result.push({ articleStart: start + leading, source: raw.slice(leading) });
    start = end;
  }
  const raw = body.slice(start);
  const leading = raw.length - raw.replace(/^\n+/u, '').length;
  if (raw.trim()) result.push({ articleStart: start + leading, source: raw.slice(leading) });
  return result;
}

export interface ContextInput {
  id?: string; word: string; meaning: string; note: string; existingSenseId?: string;
  text: string; start: number; source: string; articleId: string | null; articleStart: number | null; verified: boolean;
}
export function saveContext(data: Database, input: ContextInput): Database {
  const next = structuredClone(data);
  const word = input.word.trim(), meaning = input.meaning.trim();
  if (!word || !meaning) throw new Error('请填写字词和释义。');
  let entry = next.entries.find(e => e.word === word);
  if (!entry) { entry = { id: uid(), word }; next.entries.push(entry); }
  let sense = input.existingSenseId ? next.senses.find(s => s.id === input.existingSenseId && s.entryId === entry!.id) : next.senses.find(s => s.entryId === entry!.id && meaningKey(s.meaning) === meaningKey(meaning));
  if (input.existingSenseId && !sense) throw new Error('所选义项与字词不对应。');
  if (!sense) { sense = { id: uid(), entryId: entry.id, meaning, note: input.note.trim() }; next.senses.push(sense); }
  const old = next.contexts.find(c => c.id === input.id);
  const context: Context = {
    id: old?.id ?? uid(), senseId: sense.id, gloss: meaning, text: input.text, start: input.start,
    source: input.source.trim(), articleId: input.articleId, articleStart: input.articleStart,
    verified: input.verified, learned: !!old?.learned && old.senseId === sense.id && old.text === input.text,
  };
  const duplicate = next.contexts.find(c => c.id !== context.id && c.senseId === context.senseId && c.text === context.text && c.start === context.start && c.articleId === context.articleId && c.articleStart === context.articleStart && c.gloss === context.gloss && c.source === context.source);
  if (duplicate) throw new Error('这条例句与释义已经存在。');
  if (old) next.contexts = next.contexts.map(c => c.id === old.id ? context : c);
  else next.contexts.push(context);
  return validateDatabase(next);
}
export function saveArticle(data: Database, article: Article): Database {
  const next = structuredClone(data);
  const old = next.articles.find(a => a.id === article.id);
  if (old) {
    next.articles = next.articles.map(a => a.id === article.id ? article : a);
    if (old.body !== article.body) next.contexts = next.contexts.map(c => c.articleId === article.id ? { ...c, verified: false, learned: false } : c);
  } else next.articles.push(article);
  return validateDatabase(next);
}

// TSV is intentionally explicit: word, gloss, sentence, source, occurrence (1-based).
export function importLines(data: Database, input: string): Database {
  let next = data;
  const lines = input.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error('请先粘贴资料。');
  for (const [i, line] of lines.entries()) {
    try {
      const [word, meaning, text, source = '', occurrence = '1'] = line.split('\t').map(s => s.trim());
      if (!word || !meaning || !text) throw new Error('需要字词、释义和例句，列之间用 Tab 分隔。');
      const positions = occurrences(text, word);
      const occurrenceIndex = Number(occurrence) - 1;
      if (!Number.isInteger(occurrenceIndex) || positions[occurrenceIndex] === undefined) throw new Error('字词在例句中的出现次数不正确。');
      next = saveContext(next, { word, meaning, text, source, start: positions[occurrenceIndex], note: '', articleId: null, articleStart: null, verified: true });
    } catch (error) { throw new Error(`第 ${i + 1} 行：${error instanceof Error ? error.message : '格式不正确'}`); }
  }
  return next;
}
