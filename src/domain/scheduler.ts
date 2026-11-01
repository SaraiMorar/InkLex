import { DefaultScheduler, type DefaultSchedulerCard } from 'ts-fsrs';
import { cardSchema, contextsFor, type Context, type Database, type Grade, type StoredCard, uid } from './model';

const cache = new Map<number, ReturnType<typeof createScheduler>>();
function createScheduler(retention: number) {
  return DefaultScheduler({ version: 'FSRS-6', desiredRetention: retention, enableShortTerm: true,
    learningSteps: ['1m', '10m'], relearningSteps: ['10m'], allowModelOverride: false, enableFuzz: false });
}
export function scheduler(retention: number) {
  if (!cache.has(retention)) cache.set(retention, createScheduler(retention));
  return cache.get(retention)!;
}
function hydrate(card: StoredCard): DefaultSchedulerCard<'FSRS-6'> {
  return { ...card, dueAt: new Date(card.dueAt), lastReviewAt: card.lastReviewAt ? new Date(card.lastReviewAt) : null };
}
const serialize = (card: DefaultSchedulerCard<'FSRS-6'>) => cardSchema.parse(JSON.parse(JSON.stringify(card)));
export function localDay(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function studiedToday(data: Database, now: Date) {
  return new Set(data.reviews.filter(r => r.mode === 'scheduled' && r.before?.state === 0 && localDay(new Date(r.time)) === localDay(now)).map(r => r.senseId)).size;
}
export function eligibleSenseIds(data: Database, articleIds: string[] = []) {
  const scope = articleIds.length ? new Set(articleIds) : null;
  return new Set(data.contexts.filter(context => context.verified
    && (!scope || (context.articleId !== null && scope.has(context.articleId)))).map(context => context.senseId));
}
export function scheduledSenseReady(data: Database, senseId: string, now = new Date()) {
  const card = data.cards[senseId];
  if (!card || !eligibleSenseIds(data).has(senseId)) return false;
  return card.state === 0 ? studiedToday(data, now) < data.settings.dailyNew : new Date(card.dueAt) <= now;
}
export function studyQueue(data: Database, now: Date, articleIds: string[] = []) {
  const ids = eligibleSenseIds(data, articleIds);
  const eligible = Object.entries(data.cards).filter(([id]) => ids.has(id));
  const due = eligible.filter(([, c]) => c.state !== 0 && new Date(c.dueAt).getTime() <= now.getTime())
    .sort(([, a], [, b]) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const remaining = Math.max(0, data.settings.dailyNew - studiedToday(data, now));
  const fresh = eligible.filter(([, c]) => c.state === 0).slice(0, remaining);
  return [...due, ...fresh].map(([id]) => id);
}
export function dailyStats(data: Database, now: Date) {
  const ids = eligibleSenseIds(data);
  const cards = Object.entries(data.cards).filter(([id]) => ids.has(id)).map(([, c]) => c);
  const day = localDay(now);
  return {
    due: cards.filter(c => c.state !== 0 && new Date(c.dueAt) <= now).length,
    fresh: cards.filter(c => c.state === 0).length,
    later: cards.filter(c => c.state !== 0 && new Date(c.dueAt) > now && localDay(new Date(c.dueAt)) === day).length,
    done: data.reviews.filter(r => r.mode === 'scheduled' && localDay(new Date(r.time)) === day).length,
    learned: cards.filter(c => c.state !== 0).length,
  };
}
export async function enroll(data: Database, senseIds: string[], now = new Date()): Promise<Database> {
  const next = structuredClone(data), s = await scheduler(data.settings.retention);
  for (const id of new Set(senseIds)) {
    if (!next.cards[id] && contextsFor(next, id).length) next.cards[id] = serialize(s.newCard({ now }));
  }
  return next;
}
export function chooseContext(data: Database, senseId: string, articleIds: string[] = []): Context | undefined {
  const all = contextsFor(data, senseId, articleIds);
  const learned = all.filter(c => c.learned);
  const candidates = learned.length ? learned : all.slice(0, 1);
  const count = data.reviews.filter(r => r.senseId === senseId && r.mode === 'scheduled').length;
  return candidates[count % candidates.length];
}
export async function gradeContext(data: Database, contextId: string, grade: Grade, mode: 'scheduled' | 'practice', now = new Date()): Promise<Database> {
  const context = data.contexts.find(c => c.id === contextId && c.verified);
  if (!context) throw new Error('这条材料尚未核对，请先完成核对。');
  const next = structuredClone(data), before = data.cards[context.senseId] ?? null;
  let after: StoredCard | null = null, nativeLog = null;
  if (mode === 'scheduled') {
    if (!before) throw new Error('请先将这个义项加入学习计划。');
    if (before.state !== 0 && new Date(before.dueAt) > now) throw new Error('这项正式复习尚未到期，可以使用自选抽背练习。');
    if (before.state === 0 && studiedToday(data, now) >= data.settings.dailyNew) throw new Error('已达到今日新增量，可在学习设置中调整。');
    if (before.lastReviewAt && new Date(before.lastReviewAt) > now) throw new Error('设备时间早于上次复习，请检查系统时间。');
    const s = await scheduler(data.settings.retention);
    const result = s.review({ card: hydrate(before), grade, now });
    after = serialize(result.card);
    nativeLog = JSON.parse(JSON.stringify(result.revlog));
    next.cards[context.senseId] = after;
  }
  next.contexts = next.contexts.map(c => c.id === contextId ? { ...c, learned: true } : c);
  next.reviews.push({ id: uid(), senseId: context.senseId, contextId, time: now.toISOString(), mode, grade,
    before: mode === 'scheduled' ? before : null, after, retention: data.settings.retention, nativeLog });
  return next;
}
export async function previewGrades(data: Database, senseId: string, now = new Date()) {
  const card = data.cards[senseId];
  if (!card) return {} as Record<number, string>;
  const s = await scheduler(data.settings.retention);
  return Object.fromEntries([...s.preview({ card: hydrate(card), now })].map(item => [item.grade, item.card.dueAt.toISOString()]));
}
export async function memoryCurve(data: Database, senseId: string) {
  const c = data.cards[senseId];
  if (!c?.lastReviewAt || !c.stability) return [];
  const s = await scheduler(data.settings.retention);
  const interval = Math.max(1, (new Date(c.dueAt).getTime() - new Date(c.lastReviewAt).getTime()) / 86400000);
  const end = Math.max(7, interval * 1.5);
  return Array.from({ length: 41 }, (_, i) => ({ day: end * i / 40, probability: s.model.forgettingCurve(hydrate(c), end * i / 40) }));
}
export function intervalLabel(iso: string, now = new Date()) {
  const minutes = Math.max(1, Math.round((new Date(iso).getTime() - now.getTime()) / 60000));
  if (new Date(iso) <= now) return '已到期';
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时后`;
  return `${Math.round(minutes / 1440)} 天后`;
}
