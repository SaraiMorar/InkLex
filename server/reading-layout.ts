import { validateDatabase, type Database } from '../src/domain/model.ts';

export const READING_LAYOUT_ID = 'reading-layout-dream-poem-v1';

// The source file wrapped this poem at the printed page width. Those line
// breaks split words and sentences in the reader, so remove only wraps inside
// a sentence. Keep paragraph and verse boundaries after sentence punctuation.
export function unwrapDreamPoem(current: Database): Database {
  const next = structuredClone(current);
  const article = next.articles.find(row => row.title === '梦游天姥吟留别');
  if (!article) return next;
  const original = article.body;
  const removed = new Set<number>();
  for (let i = 0; i < original.length; i++) {
    if (original[i] === '\n' && original[i - 1] !== '\n' && original[i + 1] !== '\n'
      && !/[。！？]/u.test(original[i - 1] ?? '')) removed.add(i);
  }
  if (!removed.size) return next;
  const offsets = new Array<number>(original.length + 1);
  let count = 0;
  for (let i = 0; i <= original.length; i++) {
    offsets[i] = i - count;
    if (removed.has(i)) count++;
  }
  const body = [...original].filter((_, index) => !removed.has(index)).join('');
  for (const context of next.contexts.filter(row => row.articleId === article.id && row.articleStart !== null)) {
    const sentenceStart = context.articleStart! - context.start;
    const sentenceEnd = sentenceStart + context.text.length;
    if (sentenceStart < 0 || original.slice(sentenceStart, sentenceEnd) !== context.text) {
      // Preserve a personal edit for later manual review.
      context.verified = false;
      context.learned = false;
      continue;
    }
    const oldArticleStart = context.articleStart!;
    context.articleStart = offsets[oldArticleStart];
    context.start = offsets[oldArticleStart] - offsets[sentenceStart];
    context.text = body.slice(offsets[sentenceStart], offsets[sentenceEnd]);
  }
  article.body = body;
  return validateDatabase(next);
}
