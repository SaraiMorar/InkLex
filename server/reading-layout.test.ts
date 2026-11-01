import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/domain/seed';
import { getWord, validateDatabase } from '../src/domain/model';
import { mergeTextbookArticles } from './textbook-articles';
import { mergeTextbookGlosses } from './textbook-glosses';
import { unwrapDreamPoem } from './reading-layout';

describe('dream poem reading layout', () => {
  it('joins printed line wraps and keeps every linked gloss on the same word', () => {
    const before = mergeTextbookGlosses(mergeTextbookArticles(createSeed()));
    const article = before.articles.find(row => row.title === '梦游天姥吟留别')!;
    const originalContexts = before.contexts.filter(row => row.articleId === article.id);
    const after = unwrapDreamPoem(before);
    const poem = after.articles.find(row => row.id === article.id)!;
    expect(poem.body).toContain('云霞明灭或可睹');
    expect(poem.body).toContain('送我至剡溪');
    expect(poem.body).not.toContain('或\n可睹');
    expect(after.contexts.filter(row => row.articleId === article.id)).toHaveLength(originalContexts.length);
    for (const context of after.contexts.filter(row => row.articleId === article.id)) {
      const word = getWord(after, context.senseId);
      expect(context.verified).toBe(true);
      expect(poem.body.slice(context.articleStart!, context.articleStart! + word.length)).toBe(word);
      expect(context.text.slice(context.start, context.start + word.length)).toBe(word);
    }
    expect(unwrapDreamPoem(after)).toEqual(after);
    expect(validateDatabase(after)).toEqual(after);
  });
});
