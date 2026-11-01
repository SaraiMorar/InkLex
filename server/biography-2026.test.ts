import { describe, expect, it } from 'vitest';
import corpus from './content/biography-2026.json';
import { mergeBiography2026 } from './biography-2026';
import { articleCollection, getWord, validateDatabase } from '../src/domain/model';
import { createSeed } from '../src/domain/seed';

describe('2026 Shanghai mock-exam biography import', () => {
  it('imports 16 extracurricular texts with exact gloss positions and sentence translations', () => {
    const before = createSeed(), after = mergeBiography2026(before);
    const articles = after.articles.filter(article => article.id.startsWith('biography2026:article:'));
    const contexts = after.contexts.filter(context => context.id.startsWith('biography2026:context:'));
    expect(corpus.stats).toEqual({ articles: 16, glosses: 605, translations: 447 });
    expect(articles).toHaveLength(16); expect(contexts).toHaveLength(605);
    expect(articles.every(article => articleCollection(article) === 'extracurricular')).toBe(true);
    expect(articles.reduce((sum, article) => sum + (article.translations?.length ?? 0), 0)).toBe(447);
    for (const context of contexts) {
      const article = after.articles.find(row => row.id === context.articleId)!;
      const word = getWord(after, context.senseId);
      expect(article.body.slice(context.articleStart!, context.articleStart! + word.length)).toBe(word);
      expect(context.text.slice(context.start, context.start + word.length)).toBe(word);
    }
    for (const article of articles) for (const row of article.translations ?? []) {
      expect(article.body.slice(row.articleStart, row.articleStart + row.source.length)).toBe(row.source);
      expect(row.translation.length).toBeGreaterThan(0);
    }
    expect(validateDatabase(after)).toEqual(after);
    expect(mergeBiography2026(after)).toEqual(after);
  });

  it('links an imported word into the shared lexicon instead of creating a parallel shelf-only copy', () => {
    const before = createSeed();
    const word = corpus.articles[0].glosses[0].word;
    const existing = before.entries.find(entry => entry.word === word);
    const after = mergeBiography2026(before);
    expect(after.entries.filter(entry => entry.word === word)).toHaveLength(1);
    if (existing) expect(after.entries.find(entry => entry.word === word)?.id).toBe(existing.id);
    expect(after.contexts.some(context => context.articleId === corpus.articles[0].id
      && getWord(after, context.senseId) === word)).toBe(true);
  });
});
