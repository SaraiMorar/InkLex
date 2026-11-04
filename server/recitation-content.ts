import corpus from './content/recitation.json' with { type: 'json' };
import { validateDatabase, type Database } from '../src/domain/model.ts';

export const RECITATION_CONTENT_ID = corpus.id;
export function mergeRecitationContent(current: Database): Database {
  const data = structuredClone(current);
  data.recitation ??= { questions: [], cards: {}, reviews: [], dailyNew: 10 };
  for (const question of corpus.questions) {
    if (data.recitation.questions.some(row => row.id === question.id
      || (row.work === question.work && row.prompt.replace(/\s/g, '') === question.prompt.replace(/\s/g, '')))) continue;
    const article = data.articles.find(row => row.title.replace(/（节选）$/u, '') === question.work);
    data.recitation.questions.push({ ...structuredClone(question), articleId: article?.id ?? null });
  }
  return validateDatabase(data);
}
