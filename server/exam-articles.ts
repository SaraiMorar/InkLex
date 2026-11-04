import { createHash } from 'node:crypto';
import corpus from './content/exam-articles.json' with { type: 'json' };
import { articleSentences, getWord, meaningKey, sentenceAt, validateDatabase, type Database } from '../src/domain/model.ts';

export const EXAM_ARTICLES_ID = corpus.id;
export const examArticleStats = corpus.stats;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

// Compare the actual text, allowing different punctuation, paragraph numbering
// and line wrapping. Keep UTF-16 offsets for the reader and existing annotations.
function characters(body: string) {
  let offset = 0;
  const positions: { start: number; end: number }[] = [];
  const letters: string[] = [];
  for (const char of body) {
    if (/[\p{L}\p{N}]/u.test(char) && !/[①-⑳㉑-㊿]/u.test(char)) {
      letters.push(char); positions.push({ start: offset, end: offset + char.length });
    }
    offset += char.length;
  }
  return { text: letters.join(''), positions };
}

export function mergeExamArticles(current: Database): Database {
  const data = structuredClone(current);
  const entries = new Map(data.entries.map(entry => [entry.word, entry]));
  const senses = new Map(data.senses.map(sense => [JSON.stringify([sense.entryId, meaningKey(sense.meaning)]), sense]));
  for (const incoming of corpus.articles) {
    const source = characters(incoming.body);
    let article = data.articles.find(row => row.id === incoming.id);
    if (!article) {
      // A differently named copy or an excerpt already present in a full text
      // belongs on the existing shelf entry rather than in a duplicate entry.
      article = data.articles.find(row => {
        const text = characters(row.body).text;
        const index = text.indexOf(source.text);
        return index >= 0 && text.indexOf(source.text, index + 1) < 0;
      });
    }
    if (!article) {
      article = {
        id: incoming.id, title: incoming.title, author: incoming.author, era: incoming.era,
        body: incoming.body, summary: incoming.summary, sample: false, collection: 'extracurricular', translations: [],
      };
      data.articles.push(article);
    }
    const target = characters(article.body);
    const index = target.text.indexOf(source.text);
    // A previously installed article may have been edited. Do not restore its
    // old text or attach definitions/translations to a different passage.
    if (index < 0 || target.text.indexOf(source.text, index + 1) >= 0) continue;
    const base = [...target.text.slice(0, index)].length;
    const project = (start: number, length: number) => {
      const first = source.positions.findIndex(position => position.end > start);
      let last = first;
      while (last + 1 < source.positions.length && source.positions[last + 1].start < start + length) last++;
      return { start: target.positions[base + first].start, end: target.positions[base + last].end };
    };
    const sentences = articleSentences(article.body);
    for (const row of incoming.translations) {
      const range = project(row.articleStart, row.source.length);
      const matches = sentences.filter(sentence => sentence.articleStart < range.end
        && sentence.articleStart + sentence.source.length > range.start);
      if (!matches.length) continue;
      const start = matches[0].articleStart;
      const last = matches[matches.length - 1];
      const sourceText = article.body.slice(start, last.articleStart + last.source.length);
      if (characters(sourceText).text !== characters(row.source).text) continue;
      const translations = article.translations ?? [];
      if (translations.some(existing => existing.id === row.id || (existing.articleStart < start + sourceText.length
        && existing.articleStart + existing.source.length > start))) continue;
      article.translations = [...translations, { ...row, articleStart: start, source: sourceText }]
        .sort((a, b) => a.articleStart - b.articleStart);
    }
    for (const row of incoming.glosses) {
      const contextId = `exam2026:context:${row.ref}`;
      if (data.contexts.some(context => context.id === contextId)) continue;
      const { start, end } = project(row.articleStart, row.word.length);
      if (article.body.slice(start, end) !== row.word) continue;
      // Existing personal annotations take priority, including pending ones.
      if (data.contexts.some(context => context.articleId === article.id && context.articleStart !== null
        && context.articleStart < end && context.articleStart + getWord(data, context.senseId).length > start)) continue;
      let entry = entries.get(row.word);
      if (!entry) {
        entry = { id: `exam2026:entry:${hash(row.word)}`, word: row.word };
        entries.set(row.word, entry); data.entries.push(entry);
      }
      const senseKey = JSON.stringify([entry.id, meaningKey(row.meaning)]);
      let sense = senses.get(senseKey);
      if (!sense) {
        sense = { id: `exam2026:sense:${hash(senseKey)}`, entryId: entry.id, meaning: row.meaning,
          note: `资料：${incoming.sourceFile}。${row.issue ? `待核对：${row.issue}` : '保留资料原释义。'}` };
        senses.set(senseKey, sense); data.senses.push(sense);
      }
      const sentence = sentenceAt(article.body, start);
      data.contexts.push({
        id: contextId, senseId: sense.id, text: sentence.text, start: sentence.start,
        gloss: row.meaning, source: `《${article.title}》 · 2026金山二模${row.issue ? ` · 待核对：${row.issue}` : ''}`,
        articleId: article.id, articleStart: start, verified: !row.issue, learned: false,
      });
    }
  }
  return validateDatabase(data);
}
