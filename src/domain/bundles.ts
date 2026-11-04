import { emptyDatabase, type Database } from './model.ts';

export const GAOSAN_CONTEXT_PREFIX = 'gaosan300:context:';

// Select server-supplied material without shipping the corpus in the browser bundle.
// A first-time legacy migration must retain these examples and the user's edited articles.
export function bundledContentFrom(data: Database): Database {
  const contexts = data.contexts.filter(context => context.id.startsWith(GAOSAN_CONTEXT_PREFIX)
    || context.id.startsWith('supplement:context:') || context.id.startsWith('exam2026:context:'));
  const senseIds = new Set(contexts.map(context => context.senseId));
  const senses = data.senses.filter(sense => senseIds.has(sense.id));
  const entryIds = new Set(senses.map(sense => sense.entryId));
  const articleIds = new Set(contexts.map(context => context.articleId));
  return { ...emptyDatabase(), articles: data.articles.filter(a => a.id.startsWith('textbook5:article:')
    || a.id.startsWith('exam2026:article:') || articleIds.has(a.id)),
    entries: data.entries.filter(entry => entryIds.has(entry.id)), senses, contexts,
    ...(data.recitation ? { recitation: { questions: data.recitation.questions.filter(q => q.id.startsWith('recitation:')),
      cards: {}, reviews: [], dailyNew: 10 } } : {}) };
}
