import { cardSchema, type Database, type Grade, type RecitationQuestion, type RecitationState, type StoredCard, uid } from './model.ts';
import { localDay, scheduler } from './scheduler.ts';

export const recitationState = (data: Database): RecitationState => data.recitation ?? { questions: [], cards: {}, reviews: [], dailyNew: 10 };
const serialize = (card: unknown): StoredCard => cardSchema.parse(JSON.parse(JSON.stringify(card)));
const hydrate = (card: StoredCard) => ({ ...card, dueAt: new Date(card.dueAt), lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null });
export const normalizeRecitationAnswer = (value: string) => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');

export function recitationStats(data: Database, now = new Date()) {
  const state = recitationState(data), ids = new Set(state.questions.map(q => q.id));
  const cards = Object.entries(state.cards).filter(([id]) => ids.has(id)).map(([, card]) => card);
  const today = state.reviews.filter(review => review.mode === 'scheduled' && localDay(new Date(review.time)) === localDay(now));
  return {
    due: cards.filter(card => card.state !== 0 && new Date(card.dueAt) <= now).length,
    fresh: cards.filter(card => card.state === 0).length,
    done: today.length,
    newToday: new Set(today.filter(review => review.before?.state === 0).map(review => review.questionId)).size,
    later: cards.filter(card => card.state !== 0 && new Date(card.dueAt) > now && localDay(new Date(card.dueAt)) === localDay(now)).length,
  };
}

export function recitationQueue(data: Database, now = new Date(), scope?: string[]) {
  const state = recitationState(data), ids = new Set(scope ?? state.questions.map(q => q.id));
  const cards = Object.entries(state.cards).filter(([id]) => ids.has(id) && state.questions.some(q => q.id === id));
  const due = cards.filter(([, card]) => card.state !== 0 && new Date(card.dueAt) <= now)
    .sort(([, a], [, b]) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const fresh = cards.filter(([, card]) => card.state === 0).slice(0, Math.max(0, state.dailyNew - recitationStats(data, now).newToday));
  return [...due, ...fresh].map(([id]) => id);
}
export const recitationReady = (data: Database, id: string, now = new Date()) => recitationQueue(data, now, [id]).includes(id);

export async function enrollRecitations(data: Database, questionIds: string[], now = new Date()): Promise<Database> {
  const next = structuredClone(data); next.recitation = structuredClone(recitationState(data));
  const state = next.recitation, engine = await scheduler(data.settings.retention);
  for (const id of new Set(questionIds)) {
    if (state.questions.some(q => q.id === id) && !state.cards[id]) state.cards[id] = serialize(engine.newCard({ now }));
  }
  return next;
}

export async function gradeRecitation(data: Database, questionId: string, grade: Grade, mode: 'scheduled' | 'practice', responses: string[] = [], now = new Date()): Promise<Database> {
  const state = recitationState(data), question = state.questions.find(q => q.id === questionId);
  if (!question) throw new Error('这道默写题已不存在，请重新选择题目。');
  const before = state.cards[questionId] ?? null;
  if (mode === 'scheduled') {
    if (!before) throw new Error('请先将这道题加入默写计划。');
    if (before.state !== 0 && new Date(before.dueAt) > now) throw new Error('这道题尚未到期，可以先进行自由抽背。');
    if (before.state === 0 && recitationStats(data, now).newToday >= state.dailyNew) throw new Error('已达到今日默写新题上限。');
    if (before.lastReviewAt && new Date(before.lastReviewAt) > now) throw new Error('设备时间早于上次默写，请检查系统时间。');
  }
  const next = structuredClone(data); next.recitation = structuredClone(state);
  let after: StoredCard | null = null, nativeLog: Record<string, unknown> | null = null;
  if (mode === 'scheduled') {
    const engine = await scheduler(data.settings.retention);
    const result = engine.review({ card: hydrate(before!), grade, now });
    after = serialize(result.card); nativeLog = JSON.parse(JSON.stringify(result.revlog));
    next.recitation.cards[questionId] = after;
  }
  next.recitation.reviews.push({ id: uid(), questionId, time: now.toISOString(), mode, grade, responses,
    before: mode === 'scheduled' ? before : null, after, nativeLog, retention: data.settings.retention });
  return next;
}

export async function previewRecitation(data: Database, questionId: string, now = new Date()) {
  const card = recitationState(data).cards[questionId];
  if (!card) return {} as Record<number, string>;
  const engine = await scheduler(data.settings.retention);
  return Object.fromEntries([...engine.preview({ card: hydrate(card), now })].map(row => [row.grade, row.card.dueAt.toISOString()]));
}

export type AnswerPart = { kind: 'equal' | 'replace' | 'extra' | 'missing'; actual: string; expected: string };
function difference(actual: string, expected: string) {
  const a = [...actual], b = [...expected];
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const parts: AnswerPart[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1]) { parts.push({ kind: 'equal', actual: a[--i], expected: b[--j] }); }
    else if (i && j && dp[i][j] === dp[i - 1][j - 1] + 1) { parts.push({ kind: 'replace', actual: a[--i], expected: b[--j] }); }
    else if (i && dp[i][j] === dp[i - 1][j] + 1) { parts.push({ kind: 'extra', actual: a[--i], expected: '' }); }
    else { parts.push({ kind: 'missing', actual: '', expected: b[--j] }); }
  }
  return { distance: dp[a.length][b.length], parts: parts.reverse() };
}
export function checkRecitationAnswer(actual: string, question: RecitationQuestion, index: number) {
  const normalized = normalizeRecitationAnswer(actual);
  if (!normalized) return { status: 'empty' as const, parts: [] as AnswerPart[] };
  const choices = [question.answers[index], ...(question.alternatives?.[index] ?? [])];
  const closest = choices.map(expected => difference(normalized, normalizeRecitationAnswer(expected))).sort((a, b) => a.distance - b.distance)[0];
  return { status: closest.distance === 0 ? 'correct' as const : 'incorrect' as const, parts: closest.parts };
}
