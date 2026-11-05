import corpus from './content/recitation-chenlan.json' with { type: 'json' };
import { validateDatabase, type Database } from '../src/domain/model.ts';

export const RECITATION_CHENLAN_ID = corpus.id;
export const recitationChenlanStats = corpus.stats;
const textKey = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const workKey = (value: string) => textKey(value.replace(/（节选）$/u, ''));

export function mergeRecitationChenlan(current: Database): Database {
  const data = structuredClone(current);
  data.recitation ??= { questions: [], cards: {}, reviews: [], dailyNew: 10 };
  for (const question of corpus.questions) {
    // Keep source questions with additional notes or accepted answers visible in their own right.
    const hasExtra = Boolean(question.note) || question.alternatives.some(answers => answers.length > 0);
    const duplicate = data.recitation.questions.some(row => row.id === question.id || (!hasExtra && (
      workKey(row.work) === workKey(question.work) && textKey(row.prompt) === textKey(question.prompt)
      && row.answers.length === question.answers.length
      && row.answers.every((answer, index) => textKey(answer) === textKey(question.answers[index]))
      && (row.source !== question.source || row.number === question.number)
    )));
    if (duplicate) continue;
    const article = data.articles.find(row => workKey(row.title) === workKey(question.work));
    data.recitation.questions.push({ ...structuredClone(question), articleId: article?.id ?? null });
  }
  return validateDatabase(data);
}
