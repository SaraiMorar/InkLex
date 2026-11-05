import { describe, expect, it } from 'vitest';
import { articleSentences, articleTranslationUnits, type Article } from './model';

const article: Article = { id: 'paragraph-translation', title: '译文分组', author: '', era: '', sample: false,
  body: '前句。\n①甲句。乙句。\n丙句。', summary: '' };
describe('translation editing units', () => {
  it('preserves a supplied multi-sentence range and creates fields only for uncovered text', () => {
    const start = article.body.indexOf('①');
    const grouped = { ...article, translations: [{ id: 'group', articleStart: start, source: '①甲句。乙句。', translation: '甲乙的完整译文。' }] };
    expect(articleTranslationUnits(grouped)).toEqual([
      { articleStart: 0, source: '前句。' }, { articleStart: start, source: '①甲句。乙句。' },
      { articleStart: article.body.indexOf('丙'), source: '丙句。' },
    ]);
  });
  it('retains the existing sentence-based editor behavior without supplied grouped translations', () => {
    expect(articleTranslationUnits(article)).toEqual(articleSentences(article.body));
    const sentences = articleSentences(article.body);
    const complete = { ...article, translations: sentences.map((s, i) => ({ ...s, id: `t${i}`, translation: `译文${i}` })) };
    expect(articleTranslationUnits(complete)).toEqual(sentences);
  });
});
