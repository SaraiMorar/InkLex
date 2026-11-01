import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import articlesCorpus from '../server/content/textbook-articles.json' with { type: 'json' };

const sourcePath = resolve('resources/sources/高中语文五册_文言字词释义_全量提取表.md');
const outputPath = resolve('server/content/textbook-glosses.json');
const raw = readFileSync(sourcePath, 'utf8');
const lines = raw.split(/\r?\n/);
const rows = [];
for (const [index, line] of lines.entries()) {
  if (index < 8 || !line.trim()) continue;
  const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
  if (cells.length !== 4) throw new Error(`第 ${index + 1} 行不是四列表格。`);
  let [source, sentence, word, gloss] = cells;
  if (!source || !sentence || !word || !gloss) throw new Error(`第 ${index + 1} 行存在空字段。`);
  // The source material contains nine definitions with a closing Chinese quote
  // but no opening quote. Repair punctuation without rewriting the explanation.
  if (!gloss.includes('“') && (gloss.match(/”/g) || []).length === 1) gloss = `“${gloss}`;
  rows.push({ source, sentence, word, gloss, sourceLine: index + 1 });
}

const compact = value => value.replace(/\s/gu, '');
function compactWithMap(value) {
  let text = '';
  const rawIndices = [];
  for (let i = 0; i < value.length;) {
    const char = String.fromCodePoint(value.codePointAt(i));
    if (!/\s/u.test(char)) {
      text += char;
      for (let j = 0; j < char.length; j++) rawIndices.push(i + j);
    }
    i += char.length;
  }
  return { text, rawIndices };
}
function occurrences(text, needle) {
  const found = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

const articles = new Map(articlesCorpus.articles.map(article => {
  const volume = article.summary.match(/^(.*?) ·/)?.[1];
  if (!volume) throw new Error(`课文“${article.title}”缺少册次。`);
  return [`${volume}·${article.title}`, article];
}));
const state = new Map([...articles].map(([source, article]) => [source, { article, ...compactWithMap(article.body), cursor: 0 }]));
const records = [];
for (const [index, row] of rows.entries()) {
  const current = state.get(row.source);
  if (!current) throw new Error(`第 ${row.sourceLine} 行篇目不存在：${row.source}`);
  const sentence = compact(row.sentence);
  const candidates = [];
  for (const sentenceStart of occurrences(current.text, sentence)) {
    for (const offset of occurrences(sentence, row.word)) {
      const compactStart = sentenceStart + offset;
      const articleStart = current.rawIndices[compactStart];
      const sentenceRawStart = current.rawIndices[sentenceStart];
      const sentenceRawEnd = current.rawIndices[sentenceStart + sentence.length - 1] + 1;
      candidates.push({ articleStart, sentenceRawStart, sentenceRawEnd });
    }
  }
  const chosen = candidates.find(candidate => candidate.articleStart >= current.cursor);
  if (!chosen) throw new Error(`第 ${row.sourceLine} 行无法按原顺序定位：${row.source}｜${row.word}｜${row.sentence}`);
  const text = current.article.body.slice(chosen.sentenceRawStart, chosen.sentenceRawEnd);
  const start = chosen.articleStart - chosen.sentenceRawStart;
  if (text.slice(start, start + row.word.length) !== row.word) throw new Error(`第 ${row.sourceLine} 行字词位置不正确。`);
  current.cursor = chosen.articleStart + row.word.length;
  records.push({
    ref: String(index + 1).padStart(4, '0'), sourceLine: row.sourceLine, articleId: current.article.id,
    source: row.source, word: row.word, meaning: row.gloss, text, start, articleStart: chosen.articleStart,
  });
}

if (records.length !== 3757 || new Set(records.map(record => record.articleId)).size !== 71) {
  throw new Error(`统计不符：${records.length} 条，${new Set(records.map(record => record.articleId)).size} 篇。`);
}
const ranges = new Map();
for (const record of records) {
  const articleRanges = ranges.get(record.articleId) ?? [];
  if (articleRanges.some(range => record.articleStart < range.end && record.articleStart + record.word.length > range.start)) {
    throw new Error(`标注重叠：${record.source}｜${record.word}｜${record.sourceLine}`);
  }
  articleRanges.push({ start: record.articleStart, end: record.articleStart + record.word.length });
  ranges.set(record.articleId, articleRanges);
}

const sourceSha256 = createHash('sha256').update(raw).digest('hex');
const payload = {
  id: `textbook-glosses-v1-${sourceSha256.slice(0, 12)}`,
  title: '高中语文五册·文言文与古诗词字词释义提取表',
  sourceFile: '高中语文五册_文言字词释义_全量提取表.md', sourceSha256,
  stats: { records: records.length, articles: new Set(records.map(record => record.articleId)).size,
    words: new Set(records.map(record => record.word)).size,
    quoteRepairs: rows.filter(row => row.gloss.startsWith('“') && !lines[row.sourceLine - 1].split('|')[4]?.includes('“')).length },
  records,
};
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, id: payload.id, ...payload.stats }));
