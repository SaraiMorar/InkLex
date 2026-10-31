import { expect, it } from 'vitest';
import { articleCollection, saveArticle, validateDatabase } from './model';
import { createSeed } from './seed';
import { enroll, gradeContext } from './scheduler';

it('classifies old backups without changing article identity, annotations or study history', async () => {
  let data = createSeed();
  for (const article of data.articles) delete article.collection;
  data = validateDatabase(data);
  expect(data.articles.every(a => articleCollection(a) === 'extracurricular')).toBe(true);
  const c = data.contexts[0], now = new Date('2026-10-31T01:00:00Z');
  data = await enroll(data, [c.senseId], now);
  data = await gradeContext(data, c.id, 3, 'scheduled', now);
  const moved = saveArticle(data, { ...data.articles[0], collection: 'curricular' });
  expect(articleCollection(moved.articles[0])).toBe('curricular');
  expect(moved.contexts).toEqual(data.contexts);
  expect(moved.cards).toEqual(data.cards);
  expect(moved.reviews).toEqual(data.reviews);
  expect(moved.readings).toEqual(data.readings);
  expect(articleCollection({ ...data.articles[0], id: 'new-article' })).toBe('curricular');
});
