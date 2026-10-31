import { emptyDatabase, type Database } from './model.ts';

export const GAOSAN_CONTEXT_PREFIX = 'gaosan300:context:';

// Select server-supplied material without shipping the corpus in the browser bundle.
// A first-time legacy migration must retain these examples and the user's edited articles.
export function bundledContentFrom(data: Database): Database {
  const contexts = data.contexts.filter(context => context.id.startsWith(GAOSAN_CONTEXT_PREFIX) || context.id.startsWith('supplement:context:'));
  const senseIds = new Set(contexts.map(context => context.senseId));
  const senses = data.senses.filter(sense => senseIds.has(sense.id));
  const entryIds = new Set(senses.map(sense => sense.entryId));
  return { ...emptyDatabase(), entries: data.entries.filter(entry => entryIds.has(entry.id)), senses, contexts };
}
