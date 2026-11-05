import corpus from './content/recitation-topic01.json' with { type: 'json' };
import { validateDatabase, type Database } from '../src/domain/model.ts';

export const RECITATION_TOPIC01_ID = corpus.id;
const textKey = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const workKey = (value: string) => textKey(value.replace(/（节选）$/u, ''));

export function mergeRecitationTopic01(current: Database): Database {
  const data = structuredClone(current);
  data.recitation ??= { questions: [], cards: {}, reviews: [], dailyNew: 10 };
  for (const question of corpus.questions) {
    const duplicate = data.recitation.questions.some(row => row.id === question.id || (
      workKey(row.work) === workKey(question.work) && textKey(row.prompt) === textKey(question.prompt)
      && row.answers.length === question.answers.length
      && row.answers.every((answer, index) => textKey(answer) === textKey(question.answers[index]))
      && (row.source !== question.source || row.number === question.number)
    ));
    if (duplicate) continue;
    const article = data.articles.find(row => workKey(row.title) === workKey(question.work));
    data.recitation.questions.push({ ...structuredClone(question), articleId: article?.id ?? null });
  }
  return validateDatabase(data);
}
