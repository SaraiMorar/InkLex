import { meaningKey, validateDatabase, type Database, type Sense } from '../src/domain/model.ts';

export const SENSE_CLEANUP_ID = 'sense-cleanup-20261101-v2';

export interface SenseCleanupAudit {
  equivalentGroups: number;
  curatedGroups: number;
  mergedSenses: number;
  skippedCardConflicts: number;
}

const curated = [
  { word: '背', preferred: '违背，背叛', meanings: ['违背，背叛', '背叛'] },
  { word: '并', preferred: '合，合并', meanings: ['合，合并', '合并', '合'] },
  { word: '并', preferred: '一齐，一同', meanings: ['一齐，一同', '一起，一并'] },
  { word: '并', preferred: '皆，都', meanings: ['皆，都', '都'] },
] as const;

const importedPriority = (sense: Sense) => {
  if (!/^(gaosan300|supplement|textbook5|biography2026|sense-)/u.test(sense.id)) return 1000;
  if (sense.id.startsWith('textbook5:')) return 500;
  if (sense.id.startsWith('biography2026:')) return 400;
  if (sense.id.startsWith('gaosan300:')) return 300;
  if (sense.id.startsWith('supplement:')) return 200;
  return 100;
};

function chooseSurvivor(data: Database, senses: Sense[], preferred?: string) {
  const preferredSense = preferred && senses.find(sense => sense.meaning === preferred);
  if (preferredSense) return preferredSense;
  return [...senses].sort((a, b) => {
    const card = Number(!!data.cards[b.id]) - Number(!!data.cards[a.id]);
    if (card) return card;
    const source = importedPriority(b) - importedPriority(a);
    if (source) return source;
    const contexts = data.contexts.filter(row => row.senseId === b.id).length - data.contexts.filter(row => row.senseId === a.id).length;
    return contexts || a.id.localeCompare(b.id);
  })[0];
}

function mergeNotes(first: string, rest: string[]) {
  const lines = [...new Set([first, ...rest].flatMap(value => value.split('\n')).map(value => value.trim()).filter(Boolean))];
  const joined = lines.join('\n');
  return joined.length <= 3000 ? joined : first;
}

function mergeGroup(data: Database, senses: Sense[], audit: SenseCleanupAudit, preferred?: string) {
  if (senses.length < 2) return;
  if (senses.filter(sense => data.cards[sense.id]).length > 1) {
    audit.skippedCardConflicts++;
    return;
  }
  const survivor = chooseSurvivor(data, senses, preferred);
  const losers = senses.filter(sense => sense.id !== survivor.id);
  const loserIds = new Set(losers.map(sense => sense.id));
  survivor.note = mergeNotes(survivor.note, losers.map(sense => sense.note));
  data.contexts = data.contexts.map(context => loserIds.has(context.senseId) ? { ...context, senseId: survivor.id } : context);
  data.reviews = data.reviews.map(review => loserIds.has(review.senseId) ? { ...review, senseId: survivor.id } : review);
  for (const loser of losers) {
    if (data.cards[loser.id] && !data.cards[survivor.id]) data.cards[survivor.id] = data.cards[loser.id];
    delete data.cards[loser.id];
  }
  data.senses = data.senses.filter(sense => !loserIds.has(sense.id));
  audit.mergedSenses += losers.length;
}

export function mergeSenseCleanup(current: Database): Database {
  const data = structuredClone(current);
  const audit: SenseCleanupAudit = { equivalentGroups: 0, curatedGroups: 0, mergedSenses: 0, skippedCardConflicts: 0 };
  for (const entry of data.entries) {
    const groups = new Map<string, Sense[]>();
    for (const sense of data.senses.filter(row => row.entryId === entry.id)) {
      const key = meaningKey(sense.meaning);
      const group = groups.get(key) ?? [];
      group.push(sense); groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      audit.equivalentGroups++;
      mergeGroup(data, group, audit);
    }
  }
  for (const rule of curated) {
    const entry = data.entries.find(row => row.word === rule.word);
    if (!entry) continue;
    const group = data.senses.filter(sense => sense.entryId === entry.id && (rule.meanings as readonly string[]).includes(sense.meaning));
    if (group.length < 2) continue;
    audit.curatedGroups++;
    mergeGroup(data, group, audit, rule.preferred);
  }
  return validateDatabase(data);
}
