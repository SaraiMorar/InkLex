import corpus from './content/textbook-articles.json' with { type: 'json' };
import { validateDatabase, type Database } from '../src/domain/model.ts';

export const TEXTBOOK_ARTICLES_ID = corpus.id;

export function mergeTextbookArticles(current: Database): Database {
  const data = structuredClone(current);
  for (const article of corpus.articles) {
    // Keep personal edits and avoid adding an identical existing text twice.
    if (data.articles.some(a => a.id === article.id || (a.title === article.title && a.body === article.body))) continue;
    data.articles.push(structuredClone(article));
  }
  return validateDatabase(data);
}
