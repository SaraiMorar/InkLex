import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createSeed } from '../src/domain/seed';
import { saveContext, type Article } from '../src/domain/model';
import { enroll } from '../src/domain/scheduler';
import { mergeBundledContent } from '../server/content';
import { mergeSupplement } from '../server/supplement';
import { mergeTextbookArticles } from '../server/textbook-articles';
import { mergeTextbookGlosses } from '../server/textbook-glosses';
import { mergeBiography2026 } from '../server/biography-2026';
import { mergeBiography2025 } from '../server/biography-2025';
import { mergeBeikao2027 } from '../server/beikao-2027';
import { mergeExamArticles } from '../server/exam-articles';
import { mergeRecitationContent } from '../server/recitation-content';
import { mergeRecitationSummary } from '../server/recitation-summary';
import { mergeRecitationChenlan } from '../server/recitation-chenlan';
import { mergeRecitationTopic01 } from '../server/recitation-topic01';

const db = async (page: Page) => (await (await page.request.get('/api/state')).json()).data;

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const response = await request.put('/api/state', { data: { revision: snapshot.revision, data: createSeed() }, headers: { 'X-InkLex-Client': '1' } });
  expect(response.ok()).toBe(true);
});
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
const openFirstArticle = async (page: Page) => { await nav(page, '课文书架'); await page.getByRole('button', { name: /^课外\s*\d+ 篇$/ }).click(); await page.getByRole('button', { name: /小石潭记/ }).click(); };

test('bookshelf categories preserve original texts and allow moving new articles', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json(), data = mergeTextbookArticles(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles');
  await expect(page.locator('.article-card')).toHaveCount(71);
  await expect(page.locator('.article-card').filter({ hasText: '小石潭记' })).toHaveCount(0);
  await nav(page, '课文书架'); await page.getByRole('button', { name: /^课外\s*\d+ 篇$/ }).click();
  await expect(page.locator('.article-card')).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole('button', { name: /^课外\s*\d+ 篇$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: /小石潭记/ }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: /课文书架/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.reader-prose')).toContainText('曰恕己，曰奉壹。');
  await expect(page.locator('.word-token')).toHaveCount(13);
  await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  await expect(page.getByRole('button', { name: /^课外\s*\d+ 篇$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '添加课文', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('课文分类')).toHaveValue('extracurricular');
  await page.getByLabel('篇名', { exact: true }).fill('课外分组测试');
  await page.getByLabel('完整原文', { exact: true }).fill('学而时习之。');
  await page.getByRole('button', { name: '保存课文', exact: true }).click();
  await page.getByRole('button', { name: '编辑课文', exact: true }).click();
  await page.getByRole('dialog').getByLabel('课文分类').selectOption('curricular');
  await page.getByRole('button', { name: '保存课文', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回课文书架', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  await expect(page.locator('.article-card')).toHaveCount(72);
  const after = await db(page);
  expect(after.contexts).toEqual(data.contexts); expect(after.cards).toEqual(data.cards);
  expect(after.reviews).toEqual(data.reviews); expect(after.readings).toEqual(data.readings);
});

test('dark mode follows system changes, persists manual choice, and covers reading, editing and recall', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const root = page.locator('html'), theme = page.getByLabel('外观模式');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await theme.selectOption('light');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('dark'); await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await nav(page, '课文书架'); await page.getByRole('button', { name: /^课外\s*\d+ 篇$/ }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-dark-bookshelf.png`, fullPage: true });
  await page.getByRole('button', { name: /小石潭记/ }).click();
  await page.getByRole('button', { name: '查看「篁竹」的释义', exact: true }).click();
  const contrast = await page.locator('.reader-prose').evaluate(el => {
    const rgb = (v: string) => v.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
    const luminance = (v: string) => rgb(v).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const text = luminance(getComputedStyle(el).color), paper = luminance(getComputedStyle(el.closest('.reading-paper')!).backgroundColor);
    return (Math.max(text, paper) + .05) / (Math.min(text, paper) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: `test-results/${info.project.name}-dark-reader.png`, fullPage: true });
  await page.getByRole('button', { name: '编辑课文', exact: true }).click();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(32, 42, 35)');
  await page.screenshot({ path: `test-results/${info.project.name}-dark-editor.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '开始本篇抽背', exact: true }).click();
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-dark-recall.png`, fullPage: true });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('five textbook volumes are readable on the bookshelf without creating vocabulary or study activity', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeTextbookArticles(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles');
  await expect(page.locator('.article-card')).toHaveCount(71);
  await page.getByLabel('搜索课文').fill('选择性必修中册');
  await expect(page.locator('.article-card')).toHaveCount(8);
  await page.getByLabel('搜索课文').fill('沁园春');
  await page.locator('.article-card').click();
  await expect(page.locator('.reader-prose')).toContainText('橘子洲头。');
  await expect(page.locator('.reader-prose')).toContainText('浪遏飞舟？');
  await expect(page.locator('.reader-prose')).not.toContainText('又名水陆洲');
  await expect(page.getByRole('button', { name: '开始本篇抽背', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  await page.getByLabel('搜索课文').fill('陈情表');
  await page.locator('.article-card').click();
  await expect(page.locator('.reader-paper-heading')).toContainText('用户补全文');
  await expect(page.locator('.reader-prose')).toContainText('谨拜表以闻。');
  const saved = await db(page);
  expect(saved.entries).toEqual(snapshot.data.entries); expect(saved.contexts).toEqual(snapshot.data.contexts);
  expect(saved.reviews).toEqual(snapshot.data.reviews); expect(saved.readings).toEqual(snapshot.data.readings);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('all textbook glosses open inline and share their linked sense with the vocabulary library', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeTextbookGlosses(mergeTextbookArticles(snapshot.data));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  expect(data.contexts.filter((context: { id: string }) => context.id.startsWith('textbook5:context:'))).toHaveLength(3757);
  await page.goto('/#/articles');
  await page.getByLabel('搜索课文').fill('陈情表');
  await page.locator('.article-card').click();
  await expect(page.locator('.word-token')).toHaveCount(121);
  await page.getByRole('button', { name: '查看「险衅」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveText('（艰难祸患，指命运不好）');
  await nav(page, '我的字词库');
  await page.getByLabel('搜索字词或释义').fill('险衅');
  const entry = page.locator('.word-card').filter({ has: page.getByText('险衅', { exact: true }) });
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect(page.getByRole('dialog')).toContainText('选择性必修下册·陈情表');
  await expect(page.getByRole('dialog')).toContainText('艰难祸患，指命运不好');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('mock-exam texts show linked glosses and sentence translations while textbook texts reserve translation fields', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeBiography2026(mergeTextbookArticles(snapshot.data));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles?collection=extracurricular');
  await expect(page.getByRole('button', { name: /^课外\s*19 篇$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('搜索课文').fill('孙承宗');
  await page.locator('.article-card').click();
  await expect(page.locator('.sentence-translation')).toHaveCount(32);
  await expect(page.locator('.sentence-translation').first()).toHaveText('①孙承宗，字稚绳，是高阳人。');
  await page.getByRole('button', { name: '查看「戟张」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveText('（张开如戟）');
  await page.getByRole('button', { name: '隐藏译文', exact: true }).click();
  await expect(page.locator('.sentence-translation')).toHaveCount(0);
  await page.getByRole('button', { name: '显示译文', exact: true }).click();
  await nav(page, '我的字词库');
  await page.getByLabel('搜索字词或释义').fill('戟张');
  await expect(page.locator('.word-card').filter({ hasText: '戟张' })).toHaveCount(1);
  await nav(page, '课文书架');
  await page.getByRole('button', { name: /^课内\s*71 篇$/ }).click();
  await page.getByLabel('搜索课文').fill('沁园春');
  await page.locator('.article-card').click();
  await expect(page.getByText('逐句译文待补', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '录入译文', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('待补内容按句号分段');
  await page.getByRole('dialog').locator('textarea').first().fill('独立寒秋，湘江向北流去。');
  await page.getByRole('button', { name: '保存逐句译文', exact: true }).click();
  await expect(page.locator('.sentence-translation')).toHaveText(['独立寒秋，湘江向北流去。']);
});

test('2025 second-mock biographies retain paragraph translations and marked glosses after editing', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json(), data = mergeBiography2025(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles?collection=extracurricular');
  await expect(page.locator('.article-card')).toHaveCount(19);
  await page.getByLabel('搜索课文').fill('2025 上海高三二模');
  await expect(page.locator('.article-card')).toHaveCount(16);
  for (const title of ['李陵降匈奴（材料一、二）', '李昉传（节选）']) {
    await page.getByLabel('搜索课文').fill(title);
    await page.locator('.article-card').click();
    const article = data.articles.find(a => a.title === title)!;
    await expect(page.locator('.sentence-translation')).toHaveText(article.translations!.map(t => t.translation));
    if (title.startsWith('李陵')) {
      await page.getByRole('button', { name: '查看「盛言」的释义', exact: true }).click();
      await expect(page.locator('.inline-gloss')).toHaveText('（极力申述）');
      await expect(page.locator('.reader-prose')).toContainText('贰师，指汉代贰师将军李广利');
    } else {
      await page.getByRole('button', { name: '查看「生聚」的释义', exact: true }).click();
      await expect(page.locator('.inline-gloss')).toHaveText('（人民；生命财产）');
    }
    await page.getByRole('button', { name: '编辑逐句译文', exact: true }).click();
    const fields = page.getByRole('dialog').locator('textarea');
    await expect(fields.first()).toHaveValue(article.translations![0].translation);
    await page.getByRole('button', { name: '保存逐句译文', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.sentence-translation')).toHaveText(article.translations!.map(t => t.translation));
    expect((await db(page)).articles.find((a: Article) => a.id === article.id).translations).toEqual(article.translations);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  }
  const after = await db(page);
  expect(after.cards).toEqual(data.cards); expect(after.reviews).toEqual(data.reviews);
  const backup = await (await request.get('/api/backup')).json();
  expect(backup.articles).toEqual(after.articles);
});

test('2027 备考文言文 shows paragraph translations, marked glosses and lexicon examples', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json(), data = mergeBeikao2027(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles?collection=extracurricular');
  await expect(page.locator('.article-card')).toHaveCount(5);
  await page.getByLabel('搜索课文').fill('乌有先生传');
  await page.locator('.article-card').click();
  const wuyou = data.articles.find((a: Article) => a.title === '乌有先生传')!;
  await expect(page.locator('.sentence-translation')).toHaveText(wuyou.translations!.map(t => t.translation));
  await page.getByRole('button', { name: '查看「齿」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveText('（并列，同列）');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  await page.getByLabel('搜索课文').fill('吴樘传');
  await page.locator('.article-card').click();
  const wuchen = data.articles.find((a: Article) => a.title === '吴樘传')!;
  await page.getByRole('button', { name: '查看「会」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveText('（恰巧，正好，适逢）');
  await expect(page.locator('.reader-prose')).toContainText('[注释]①文化常识：伯仲叔季');
  expect((await db(page)).articles.find((a: Article) => a.id === wuchen.id)!.body).toBe(wuchen.body);
  // 勾连教材例句进入字词库：同一义项挂着文章内与教材两处例句。
  await nav(page, '我的字词库');
  await page.getByLabel('搜索字词或释义').fill('并列，同列');
  await page.locator('.word-card').filter({ has: page.getByText('齿', { exact: true }) }).click();
  await expect(page.getByRole('dialog')).toContainText('君子不齿');
  await expect(page.getByRole('dialog')).toContainText('《乌有先生传》 · 2027备考');
  await expect(page.getByRole('dialog')).toContainText('《师说》 · 乌有-003');
  const after = await db(page);
  expect(after.cards).toEqual(data.cards); expect(after.reviews).toEqual(data.reviews);
  const backup = await (await request.get('/api/backup')).json();
  expect(backup.articles).toEqual(after.articles);
});

test('answer-document texts appear once with all translations and retain translations after editing', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeExamArticles(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles?collection=extracurricular');
  await expect(page.locator('.article-card')).toHaveCount(9);
  for (const article of data.articles.filter(row => row.id.startsWith('exam2026:article:'))) {
    await page.getByLabel('搜索课文').fill(article.title);
    await expect(page.locator('.article-card')).toHaveCount(1);
    await page.locator('.article-card').click();
    await expect(page.locator('.sentence-translation')).toHaveText(article.translations!.map(row => row.translation));
    await page.getByRole('button', { name: '隐藏译文', exact: true }).click();
    await expect(page.locator('.sentence-translation')).toHaveCount(0);
    await page.getByRole('button', { name: '显示译文', exact: true }).click();
    await page.getByRole('button', { name: '编辑逐句译文', exact: true }).click();
    await expect(page.getByRole('dialog').locator('textarea')).toHaveCount(article.translations!.length);
    await page.getByRole('button', { name: '保存逐句译文', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.sentence-translation')).toHaveText(article.translations!.map(row => row.translation));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '返回课文书架', exact: true }).click();
  }
  await page.getByLabel('搜索课文').fill('李孔昭'); await page.locator('.article-card').click();
  await page.getByRole('button', { name: '查看「孤介」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveText('（耿直）');
  await page.getByRole('button', { name: '查看「币」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss').last()).toHaveText('（钱币）');
  await expect(page.locator('.sentence-translation').filter({ hasText: '书信和礼物' })).toHaveCount(1);
  await expect(page.locator('.word-token')).toHaveCount(54);
  await page.reload();
  await expect(page.locator('.sentence-translation')).toHaveCount(29);
});

test('understanding recitation filters 77 questions, checks exact characters and retries failed saves', async ({ page, request }, info) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeRecitationContent(mergeTextbookArticles(snapshot.data));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: '去默写', exact: true }).click();
  await expect(page.getByRole('heading', { name: '理解性默写', exact: true })).toBeVisible();
  await expect(page.locator('.recitation-card')).toHaveCount(77);
  await page.locator('.recitation-works').getByRole('button', { name: /^离骚/ }).click();
  await expect(page.locator('.recitation-card')).toHaveCount(20);
  await page.getByLabel('搜索默写题').fill('修洁');
  await expect(page.locator('.recitation-card')).toHaveCount(1);
  await page.getByRole('button', { name: '背这道题', exact: true }).click();
  await expect(page.locator('.recitation-answer')).toHaveCount(0);
  await expect(page.locator('.rating-button')).toHaveCount(0);
  await page.getByLabel('第 1 空', { exact: true }).fill('余虽好修姱以羁兮');
  await page.getByLabel('第 2 空', { exact: true }).fill('謇朝谇而夕替。');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.incorrect ins')).toHaveText('鞿');
  await expect(page.locator('.check-row.correct')).toContainText('第 2 空');
  await page.screenshot({ path: `test-results/${info.project.name}-recitation-check.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  let failed = false;
  await page.route('**/api/state', async route => {
    if (route.request().method() === 'PUT' && !failed) { failed = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '默写保存测试失败' }) }); }
    else await route.continue();
  });
  await page.locator('.rating-button.good').click();
  await expect(page.getByRole('status')).toContainText('默写保存测试失败');
  await expect(page.locator('.session-finish')).toHaveCount(0);
  expect((await db(page)).recitation.reviews).toHaveLength(0);
  await page.locator('.rating-button.good').click();
  await expect(page.locator('.session-finish')).toContainText('已完成 1 道');
  await page.reload();
  const after = await db(page);
  expect(after.recitation.reviews).toHaveLength(1);
  expect(after.recitation.reviews[0]).toMatchObject({ mode: 'practice', questionId: 'recitation:lisao:005' });
  expect(after.recitation.cards).toEqual({}); expect(after.cards).toEqual(data.cards); expect(after.reviews).toEqual(data.reviews);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.recitation-card')).toHaveCount(77);
});

test('understanding recitation plans persist and only a scored recall updates the schedule', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeRecitationContent(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/recitation');
  await page.getByLabel('搜索默写题').fill('开篇以');
  await expect(page.locator('.recitation-card')).toHaveCount(1);
  await page.getByRole('button', { name: '加入默写计划', exact: true }).click();
  await expect(page.getByRole('button', { name: '已加入计划', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始默写复习', exact: true }).click();
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  expect((await db(page)).recitation.reviews).toHaveLength(0);
  await page.reload();
  await page.getByRole('button', { name: '今日复习', exact: true }).click();
  await page.getByRole('button', { name: '开始默写复习', exact: true }).click();
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await page.locator('.rating-button.again').click();
  await expect(page.locator('.session-finish')).toContainText('已完成 1 道');
  const after = await db(page), id = 'recitation:chenqingbiao:001';
  expect(after.recitation.reviews).toHaveLength(1);
  expect(after.recitation.reviews[0]).toMatchObject({ mode: 'scheduled', questionId: id, grade: 1 });
  expect(Date.parse(after.recitation.cards[id].dueAt) - Date.parse(after.recitation.cards[id].lastReviewAt)).toBe(60000);
  expect(after.cards).toEqual(data.cards); expect(after.reviews).toEqual(data.reviews);
  const backup = await (await request.get('/api/backup')).json();
  expect(backup.recitation).toEqual(after.recitation);
  await page.getByRole('button', { name: '回到理解性默写', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始默写复习', exact: true })).toBeDisabled();
  await page.reload();
  expect((await db(page)).recitation.cards[id]).toEqual(after.recitation.cards[id]);
});

test('the supplied recitation collection supports exact recall and a practice session containing all questions', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeRecitationSummary(mergeRecitationContent(mergeTextbookArticles(snapshot.data)));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/recitation');
  await expect(page.locator('.recitation-card')).toHaveCount(286);
  await page.locator('.recitation-works').getByRole('button', { name: /^沁园春·长沙/ }).click();
  await expect(page.locator('.recitation-card')).toHaveCount(10);
  const first = page.locator('.recitation-card').first();
  await expect(first.locator('.recitation-source')).toContainText('理解性默写汇总_答案填写版');
  await first.locator('summary').click();
  await expect(first.locator('.recitation-reference')).toContainText('独立寒秋');
  await first.getByRole('button', { name: '背这道题', exact: true }).click();
  await expect(page.locator('.recitation-source')).toContainText('理解性默写汇总_答案填写版');
  await page.getByLabel('第 1 空', { exact: true }).fill('独立寒秋');
  await page.getByLabel('第 2 空', { exact: true }).fill('湘江东去');
  await page.getByLabel('第 3 空', { exact: true }).fill('橘子洲头');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.incorrect del')).toHaveText('东');
  await expect(page.locator('.check-row.incorrect ins')).toHaveText('北');
  await expect(page.locator('.check-row.correct')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.rating-button.good').click();
  await expect(page.locator('.session-finish')).toContainText('已完成 1 道');
  const saved = await db(page);
  expect(saved.recitation.reviews).toHaveLength(1);
  expect(saved.recitation.reviews[0]).toMatchObject({ mode: 'practice', questionId: 'recitation:summary:0004' });
  expect(saved.cards).toEqual(data.cards); expect(saved.reviews).toEqual(data.reviews);
  await page.getByRole('button', { name: '回到理解性默写', exact: true }).click();
  await page.locator('.recitation-works').getByRole('button', { name: /^蜀道难/ }).click();
  await page.getByLabel('搜索默写题').fill('神秘和悠远');
  await expect(page.locator('.recitation-card')).toHaveCount(1);
  await page.getByRole('button', { name: '背这道题', exact: true }).click();
  await page.getByLabel('第 1 空', { exact: true }).fill('蚕丛及鱼凫');
  await page.getByLabel('第 2 空', { exact: true }).fill('开国何茫然');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.correct')).toHaveCount(2);
  await expect(page.locator('.recitation-reference')).toContainText('另一组可接受答案');
  await page.getByRole('button', { name: '返回默写题库', exact: true }).click();
  await page.getByLabel('搜索默写题').fill('');
  await page.locator('.recitation-works').getByRole('button', { name: /^全部篇目/ }).click();
  await page.getByRole('button', { name: '自由抽背', exact: true }).click();
  await page.getByLabel('默写题量').selectOption('0');
  await page.getByLabel('默写出题顺序').selectOption('ordered');
  await page.getByRole('button', { name: '开始默写抽背', exact: true }).click();
  await expect(page.locator('.session-header')).toContainText('1 / 286');
});

test('Chenqingbiao and Lanting supplement supports both stated variants and three-part recall', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeRecitationChenlan(mergeRecitationSummary(mergeRecitationContent(mergeTextbookArticles(snapshot.data))));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/recitation');
  await expect(page.locator('.recitation-card')).toHaveCount(322);
  await page.locator('.recitation-works').getByRole('button', { name: /^陈情表/ }).click();
  await page.getByLabel('搜索默写题').fill('凄凉比喻');
  await expect(page.locator('.recitation-card')).toHaveCount(1);
  await expect(page.locator('.recitation-source')).toContainText('陈情表与兰亭集序补充默写');
  await page.getByRole('button', { name: '背这道题', exact: true }).click();
  await page.getByLabel('第 1 空', { exact: true }).fill('但以刘日薄西山');
  await page.getByLabel('第 2 空', { exact: true }).fill('气息奄奄');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.correct')).toHaveCount(2);
  await expect(page.locator('.recitation-reference')).toContainText('原文完整表述为“但以刘日薄西山，气息奄奄”');
  await page.locator('.rating-button.good').click();
  await expect(page.locator('.session-finish')).toContainText('已完成 1 道');
  await page.getByRole('button', { name: '回到理解性默写', exact: true }).click();
  await page.locator('.recitation-works').getByRole('button', { name: /^兰亭集序/ }).click();
  await page.getByLabel('搜索默写题').fill('先前所喜欢的事物');
  await expect(page.locator('.recitation-card')).toHaveCount(1);
  await page.getByRole('button', { name: '背这道题', exact: true }).click();
  await page.getByLabel('第 1 空', { exact: true }).fill('向之所欣');
  await page.getByLabel('第 2 空', { exact: true }).fill('俯仰之间');
  await page.getByLabel('第 3 空', { exact: true }).fill('已成陈迹');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.correct')).toHaveCount(2);
  await expect(page.locator('.check-row.incorrect del')).toHaveText('成');
  await expect(page.locator('.check-row.incorrect ins')).toHaveText('为');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const saved = await db(page);
  expect(saved.recitation.reviews).toHaveLength(1);
  expect(saved.recitation.reviews[0]).toMatchObject({ mode: 'practice', questionId: 'recitation:chenlan:chenqingbiao:014' });
  expect(saved.cards).toEqual(data.cards); expect(saved.reviews).toEqual(data.reviews);
});

test('Topic 01 imports only understanding questions and supports precise character recall', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeRecitationTopic01(mergeRecitationChenlan(mergeRecitationSummary(mergeRecitationContent(mergeTextbookArticles(snapshot.data)))));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/recitation');
  await expect(page.locator('.recitation-card')).toHaveCount(338);
  const selected = page.locator('.recitation-card').filter({ hasText: '专题01 积累运用（解析版）' });
  await expect(selected).toHaveCount(16);
  await expect(selected.filter({ hasText: '盖将自其变者而观之' })).toHaveCount(0);
  await expect(selected.filter({ hasText: '忠而被谤' })).toHaveCount(0);
  await page.getByLabel('搜索默写题').fill('五丁开山');
  await expect(selected).toHaveCount(1);
  await selected.getByRole('button', { name: '背这道题', exact: true }).click();
  await page.getByLabel('第 1 空', { exact: true }).fill('地崩山催壮士死');
  await page.getByLabel('第 2 空', { exact: true }).fill('然后天梯石栈相钩连');
  await page.getByRole('button', { name: '查看答案并核对', exact: true }).click();
  await expect(page.locator('.check-row.correct')).toHaveCount(1);
  await expect(page.locator('.check-row.incorrect del')).toHaveText('催');
  await expect(page.locator('.check-row.incorrect ins')).toHaveText('摧');
  await expect(page.locator('.recitation-reference')).toContainText('2025·上海黄浦·二模');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.rating-button.again').click();
  await expect(page.locator('.session-finish')).toContainText('已完成 1 道');
  await page.reload();
  const saved = await db(page);
  expect(saved.recitation.reviews).toHaveLength(1);
  expect(saved.recitation.reviews[0]).toMatchObject({ mode: 'practice', questionId: 'recitation:topic01:001' });
  expect(saved.cards).toEqual(data.cards); expect(saved.reviews).toEqual(data.reviews);
});

test('full original text, independent inline explanations, no false reviews, responsive layout', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: '温故，而知新。' })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-dashboard.png`, fullPage: true });
  await openFirstArticle(page);
  await expect(page.locator('.reader-prose')).toContainText('曰恕己，曰奉壹。');
  const first = page.getByRole('button', { name: '查看「篁竹」的释义', exact: true });
  await first.click(); await expect(page.locator('.inline-gloss')).toHaveText('（竹林）');
  await page.getByRole('button', { name: '查看「清冽」的释义', exact: true }).click();
  await expect(page.locator('.inline-gloss')).toHaveCount(2);
  await first.click(); await expect(page.locator('.inline-gloss')).toHaveCount(1);
  await expect.poll(async () => (await db(page)).readings.length).toBe(2);
  const data = await db(page); expect(data.reviews).toHaveLength(0); expect(Object.keys(data.cards)).toHaveLength(0); expect(data.readings).toHaveLength(2);
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); expect(noOverflow).toBe(true);
  await page.screenshot({ path: `test-results/${info.project.name}-reader.png`, fullPage: true });
  await page.getByRole('button', { name: '收起全部' }).click(); await expect(page.locator('.inline-gloss')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('word sorting and list view preserve search, details and display preferences', async ({ page }, info) => {
  const before = await db(page);
  await page.goto('/#/words');
  const words = page.locator('.word-grid .word-display');
  const initial = before.entries.map((e: { word: string }) => e.word);
  await expect(words).toHaveText(initial);
  const sort = page.getByLabel('字词排序');
  await sort.selectOption('pinyin');
  const alphabetic = [...initial].sort(new Intl.Collator('zh-CN-u-co-pinyin').compare);
  await expect(words).toHaveText(alphabetic);
  await sort.selectOption('pinyin-desc');
  await expect(words).toHaveText([...alphabetic].reverse());
  for (const order of ['senses', 'contexts']) {
    await sort.selectOption(order);
    const expected = [...before.entries].sort((a, b) => {
      const count = (entry: { id: string }) => {
        const senses = before.senses.filter((s: { entryId: string }) => s.entryId === entry.id);
        return order === 'senses' ? senses.length : before.contexts.filter((c: { senseId: string }) => senses.some((s: { id: string }) => s.id === c.senseId)).length;
      };
      return count(b) - count(a) || new Intl.Collator('zh-CN-u-co-pinyin').compare(a.word, b.word);
    });
    await expect(words).toHaveText(expected.map(e => e.word));
  }
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('.word-grid')).toHaveClass(/is-list/);
  await sort.selectOption('pinyin');
  await page.reload();
  await expect(sort).toHaveValue('pinyin');
  await expect(page.getByRole('button', { name: '列表', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(words).toHaveText(alphabetic);
  const search = page.getByLabel('搜索字词或释义');
  await search.fill('篁竹');
  await expect(words).toHaveText(['篁竹', '乐']);
  await page.locator('.word-card').filter({ has: page.getByText('篁竹', { exact: true }) }).click();
  await expect(page.getByRole('dialog')).toContainText('竹林');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await search.fill('');
  await page.getByRole('button', { name: '计划内', exact: true }).click();
  await expect(words).toHaveCount(0);
  await page.getByRole('button', { name: '全部字词', exact: true }).click();
  await page.getByLabel('外观模式').selectOption('dark');
  await page.screenshot({ path: `test-results/${info.project.name}-word-list.png`, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '卡片', exact: true }).click();
  await expect(page.locator('.word-grid')).not.toHaveClass(/is-list/);
  await sort.selectOption('default');
  await expect(words).toHaveText(initial);
  expect(await db(page)).toEqual(before);
});

test('formal recall only schedules after rating and survives reload and time passage', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T02:00:00Z') });
  await page.goto('/'); await openFirstArticle(page);
  await page.getByRole('button', { name: '开始本篇抽背' }).click();
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  expect((await db(page)).reviews).toHaveLength(0);
  await page.reload(); await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看释义', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await page.getByRole('button', { name: /忘记了/ }).click();
  await expect(page.getByRole('status')).toContainText('已记录');
  let data = await db(page); expect(data.reviews).toHaveLength(1);
  const event = data.reviews[0]; expect(event.mode).toBe('scheduled');
  expect(Date.parse(data.cards[event.senseId].dueAt) - Date.parse(event.time)).toBe(60000);
  await page.getByRole('button', { name: '退出本轮' }).click();
  await page.clock.fastForward(61000); await nav(page, '今日学习');
  await expect(page.locator('.stat-card').filter({ hasText: '到期待复习' }).locator('.stat-number')).toContainText('1');
  await page.reload(); data = await db(page); expect(data.reviews).toHaveLength(1);
  await expect(page.locator('.stat-card').filter({ hasText: '今日已复习' }).locator('.stat-number')).toContainText('1');
});

test('review search and collection tags constrain both scheduled and practice questions', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  snapshot.data.articles.find((a: { id: string }) => a.id === 'sample-xiaoshitan').collection = 'curricular';
  const data = await enroll(snapshot.data, snapshot.data.senses.map((s: { id: string }) => s.id));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/review');
  const tags = page.getByRole('group', { name: '复习篇目标签' });
  const search = page.getByRole('textbox', { name: '搜索复习篇目' });
  const options = page.locator('.scope-options');
  await tags.getByRole('button', { name: '课内', exact: true }).click();
  await expect(options.getByRole('button', { name: /小石潭记/ })).toBeVisible();
  await expect(options.getByRole('button', { name: /陋室铭/ })).toHaveCount(0);
  await search.fill('柳宗元');
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await expect(page.locator('.question-source')).toContainText('小石潭记');
  await page.getByRole('button', { name: '退出本轮', exact: true }).click();
  await search.fill('没有这篇文章');
  await expect(page.getByRole('button', { name: '开始今日复习', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /自选抽背 按范围练习/ }).click();
  await expect(page.getByRole('button', { name: '开始随机抽背' })).toBeDisabled();
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await options.getByRole('button', { name: /小石潭记/ }).click();
  await tags.getByRole('button', { name: '课外', exact: true }).click();
  await expect(page.locator('.scope-summary')).toContainText('筛选出的 2 篇');
  await search.fill('陋室');
  await expect(options.getByRole('button', { name: /爱莲说/ })).toHaveCount(0);
  await page.getByRole('button', { name: '开始随机抽背' }).click();
  await expect(page.locator('.question-source')).toContainText('陋室铭');
  await page.getByRole('button', { name: '退出本轮', exact: true }).click();
  await expect(search).toHaveValue('陋室');
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await tags.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.scope-summary')).toContainText('全部资料（含独立例句）');
  await expect(options.getByRole('button')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const after = await db(page);
  expect(after.reviews).toEqual(data.reviews); expect(after.cards).toEqual(data.cards);
});

test('random practice records answers without altering official schedules', async ({ page }) => {
  await page.goto('/'); await nav(page, '抽背与复习');
  await page.getByRole('button', { name: /自选抽背 按范围练习/ }).click();
  await page.getByRole('button', { name: '开始随机抽背' }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await page.getByRole('button', { name: /很熟练/ }).click();
  await expect.poll(async () => (await db(page)).reviews.length).toBe(1);
  const data = await db(page); expect(data.reviews).toHaveLength(1); expect(data.reviews[0].mode).toBe('practice'); expect(Object.keys(data.cards)).toHaveLength(0);
});

test('create an article and mark the second occurrence accurately', async ({ page }) => {
  await page.goto('/'); await nav(page, '资料与设置');
  await page.getByRole('button', { name: /添加一篇课文/ }).click();
  await page.getByLabel('篇名', { exact: true }).fill('定位测试');
  await page.getByLabel('完整原文', { exact: true }).fill('顾而顾。\n\n又见故人。');
  await page.getByRole('button', { name: '保存课文' }).click();
  await page.getByRole('button', { name: '添加标注', exact: true }).click();
  await page.getByRole('button', { name: '标注第 3 字「顾」', exact: true }).click();
  await expect(page.getByLabel('目标字词', { exact: true })).toHaveValue('顾');
  await expect(page.getByLabel('选择字词出现的位置')).toHaveValue('2');
  await page.getByLabel('本处释义', { exact: true }).fill('回头看，这是一条用于检查手机自动换行的较长释义');
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/articles\//);
  await nav(page, '课文书架'); await page.getByRole('button', { name: /定位测试/ }).click();
  await page.getByRole('button', { name: '查看「顾」的释义' }).click();
  await expect(page.locator('.reader-prose')).toContainText('顾而顾（回头看');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const data = await db(page); const article = data.articles.find((a: {title: string}) => a.title === '定位测试');
  const context = data.contexts.find((c: {articleId: string}) => c.articleId === article.id);
  expect(context.articleStart).toBe(2);
  await page.reload(); await expect(page.getByRole('button', { name: '查看「顾」的释义' })).toBeVisible();
});

test('annotations stay on the bookshelf and distinguish repeated words and phrases without recording study', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = createSeed();
  data.articles.push({ id: 'repeated-words', title: '标注位置测试', body: '顾而顾。\n顾念顾念。', author: '', era: '', summary: '', sample: false });
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/articles/repeated-words');
  await page.getByRole('button', { name: '编辑标注', exact: true }).click();
  for (const [position, meaning] of [[1, '回头看'], [3, '顾念']] as const) {
    await page.getByRole('button', { name: `标注第 ${position} 字「顾」`, exact: true }).click();
    await page.getByLabel('本处释义', { exact: true }).fill(meaning);
    await page.getByRole('button', { name: '保存字词', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '标注第 3 字「顾」', exact: true }).click();
  await expect(page.getByLabel('本处释义', { exact: true })).toHaveValue('顾念');
  await page.getByLabel('本处释义', { exact: true }).fill('看，视');
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('选择词组（依次点击起字、止字）').check();
  await page.getByRole('button', { name: '标注第 8 字「顾」', exact: true }).click();
  await page.getByRole('button', { name: '标注第 9 字「念」', exact: true }).click();
  await expect(page.getByLabel('目标字词', { exact: true })).toHaveValue('顾念');
  await expect(page.getByLabel('选择字词出现的位置')).toHaveValue('7');
  await page.getByLabel('本处释义', { exact: true }).fill('顾及，惦念');
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '完成标注', exact: true }).click();
  const saved = await db(page), contexts = saved.contexts.filter((c: { articleId: string }) => c.articleId === 'repeated-words');
  expect(contexts.map((c: {articleStart: number; gloss: string}) => [c.articleStart, c.gloss])).toEqual([[0, '回头看'], [2, '看，视'], [7, '顾及，惦念']]);
  expect(saved.reviews).toHaveLength(0); expect(saved.readings).toHaveLength(0); expect(Object.keys(saved.cards)).toHaveLength(0);
  await page.reload();
  await expect(page.locator('.reader-prose .word-token')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('changed text requires explicit relocation rather than silently using the first occurrence', async ({ page }) => {
  await page.goto('/#/articles/sample-xiaoshitan');
  await page.getByRole('button', { name: '编辑课文', exact: true }).click();
  await page.getByLabel('完整原文', { exact: true }).fill('篁竹在前，篁竹在后。');
  await page.getByRole('button', { name: '保存课文', exact: true }).click();
  await page.getByRole('button', { name: '在本篇核对', exact: true }).click();
  await page.locator('.manage-row').filter({ has: page.locator('.word-mini', { hasText: /^篁竹$/ }) }).getByRole('button', { name: '重新定位与核对' }).click();
  await expect(page.getByLabel('选择字词出现的位置')).toHaveValue('-1');
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('明确选择');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('选择字词出现的位置').selectOption('5');
  await page.getByLabel('已核对释义与标注位置').check();
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '完成标注', exact: true }).click();
  await expect(page.locator('.reader-prose')).toHaveJSProperty('textContent', '篁竹在前，篁竹在后。');
  const context = (await db(page)).contexts.find((c: {articleId: string; articleStart: number; verified: boolean}) => c.articleId === 'sample-xiaoshitan' && c.articleStart === 5 && c.verified);
  expect(context).toBeTruthy();
});

test('backup import is validated, idempotent, and can restore progress', async ({ page }) => {
  await page.goto('/'); await nav(page, '资料与设置');
  const original = await db(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const download = await downloadPromise; const path = await download.path();
  const backup = await readFile(path!, 'utf8'); expect(JSON.parse(backup)).toEqual(original);
  await page.getByLabel('导入备份文件').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('status')).toContainText('有效的 JSON'); expect(await db(page)).toEqual(original);
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('导入备份文件').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.getByRole('button', { name: '确认合并' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(await db(page)).toEqual(original);
  await page.getByLabel('每日新增义项').fill('4'); await page.getByRole('button', { name: '保存学习设置' }).click();
  await expect.poll(async () => (await db(page)).settings.dailyNew).toBe(4);
  await page.getByLabel('导入备份文件').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.getByLabel('完整恢复这份备份', { exact: false }).check();
  await page.getByRole('button', { name: '确认恢复' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await db(page)).toEqual(original);
  await expect(page.getByLabel('每日新增义项')).toHaveValue(String(original.settings.dailyNew));
});

test('two tabs cannot rate the same formal card twice', async ({ page, context }) => {
  await page.goto('/'); await openFirstArticle(page);
  await page.getByRole('button', { name: '开始本篇抽背' }).click();
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/#/review?article=sample-xiaoshitan');
  await other.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await other.getByRole('button', { name: '查看释义', exact: true }).click();
  await Promise.all([page.getByRole('button', { name: /记得.*分钟后/ }).click(), other.getByRole('button', { name: /记得.*分钟后/ }).click()]);
  await expect.poll(async () => (await db(page)).reviews.length).toBe(1);
  await expect.poll(async () => (await db(other)).reviews.length).toBe(1);
  await other.reload();
  expect((await db(other)).reviews).toHaveLength(1);
});

test('browser storage can be disabled without losing server-side progress', async ({ page, browser }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
    Storage.prototype.getItem = () => { throw new DOMException('Disabled', 'SecurityError'); };
  });
  await page.goto('/'); await nav(page, '抽背与复习');
  await page.getByRole('button', { name: /自选抽背 按范围练习/ }).click();
  await page.getByRole('button', { name: '开始随机抽背' }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '查看释义', exact: true }).click();
    await page.getByRole('button', { name: /很熟练/ }).click();
    await expect(page.locator('.session-header')).toContainText(`自选抽背 · ${i + 2} /`);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await db(page)).reviews).toHaveLength(2);
  const independent = await browser.newContext();
  const other = await independent.newPage();
  await other.goto('http://127.0.0.1:5183/');
  await expect(other.getByRole('heading', { name: '温故，而知新。' })).toBeVisible();
  expect((await (await other.request.get('http://127.0.0.1:5183/api/state')).json()).data.reviews).toHaveLength(2);
  await independent.close();
});

test('a failed server save leaves the question available for retry', async ({ page }) => {
  await page.goto('/'); await nav(page, '抽背与复习');
  await page.getByRole('button', { name: /自选抽背 按范围练习/ }).click();
  await page.getByRole('button', { name: '开始随机抽背' }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await page.route('**/api/state', route => route.request().method() === 'PUT' ? route.abort() : route.continue());
  await page.getByRole('button', { name: /很熟练/ }).click();
  await expect(page.getByRole('alert')).toContainText('保存尚未确认');
  await expect(page.locator('.session-header')).toContainText('自选抽背 · 1 /');
  expect((await db(page)).reviews).toHaveLength(0);
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: /很熟练/ }).click();
  await expect(page.locator('.session-header')).toContainText('自选抽背 · 2 /');
  expect((await db(page)).reviews).toHaveLength(1);
});

test('legacy browser data migrates once and the original remains recoverable', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const legacy = saveContext(snapshot.data, { word: '故', meaning: '旧的知识', text: '温故而知新。', start: 1, source: '旧版笔记', note: '', articleId: null, articleStart: null, verified: true });
  const raw = JSON.stringify(legacy);
  await page.addInitScript(raw => { localStorage.setItem('inklex.database.v1', raw); }, raw);
  await page.goto('/'); await nav(page, '我的字词库');
  await page.getByLabel('搜索字词或释义').fill('故');
  await expect(page.locator('.word-card')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('inklex.database.v1'))).toBe(raw);
  const migrated = await (await request.get('/api/state')).json();
  expect(migrated.data.entries.length).toBe(legacy.entries.length);
  await page.reload(); await expect(page.getByLabel('搜索字词或释义')).toBeVisible();
  const again = await (await request.get('/api/state')).json();
  expect(again.revision).toBe(migrated.revision);
  expect(again.data).toEqual(migrated.data);
});

test('API rejects stale revisions, invalid data and cross-site writes', async ({ request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const headers = { 'X-InkLex-Client': '1' };
  const edited = { ...snapshot.data, settings: { ...snapshot.data.settings, dailyNew: 7 } };
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data: edited }, headers })).ok()).toBe(true);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data: snapshot.data }, headers })).status()).toBe(409);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision + 1, data: { ...edited, version: 99 } }, headers })).status()).toBe(400);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision + 1, data: edited }, headers: { ...headers, Origin: 'https://unrelated.example' } })).status()).toBe(403);
  expect((await (await request.get('/api/state')).json()).data.settings.dailyNew).toBe(7);
});

test('the full imported library can be searched, shows the correct target and joins spaced review', async ({ page, request }, info) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeBundledContent(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/words');
  await page.getByLabel('搜索字词或释义').fill('高三300实词');
  await expect(page.locator('.word-card')).toHaveCount(300);
  await page.getByLabel('搜索字词或释义').fill('超乘者');
  await expect(page.locator('.word-card')).toHaveCount(2); // Both 超 and 乘 use this sentence.
  await page.locator('.word-card').filter({ has: page.locator('.word-display', { hasText: /^乘$/ }) }).click();
  const example = page.locator('.context-example').filter({ hasText: '超乘者三百乘。' });
  await expect(example.locator('.example-prose')).toHaveJSProperty('innerHTML', '超乘者三百<mark>乘</mark>。');
  await example.locator('xpath=..').getByRole('button', { name: '加入计划', exact: true }).click();
  await expect.poll(async () => Object.keys((await db(page)).cards).length).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/${info.project.name}-imported-word.png`, fullPage: true });
  await page.goto('/#/review');
  await page.getByRole('button', { name: '开始今日复习', exact: true }).click();
  await page.getByRole('button', { name: '查看释义', exact: true }).click();
  await page.getByRole('button', { name: /忘记了/ }).click();
  await expect.poll(async () => (await db(page)).reviews.length).toBe(1);
  await page.reload();
  const stored = await db(page); const event = stored.reviews[0];
  expect(event.contextId).toBe('gaosan300:context:14:19');
  expect(Date.parse(stored.cards[event.senseId].dueAt) - Date.parse(event.time)).toBe(60000);
});

test('editing a flagged source does not silently approve it for study', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeBundledContent(snapshot.data);
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/manage?context=gaosan300:context:59:8');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('已核对释义与标注位置')).not.toBeChecked();
  await expect(page.getByRole('dialog').locator('.sense-note')).toContainText('原资料将目标字');
  await page.getByRole('button', { name: '保存字词', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await db(page);
  expect(saved.contexts.find((c: {id: string}) => c.id === 'gaosan300:context:59:8').verified).toBe(false);
});

test('supplement particles and split examples are searchable and can join review', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/state')).json();
  const data = mergeSupplement(mergeBundledContent(snapshot.data));
  expect((await request.put('/api/state', { data: { revision: snapshot.revision, data }, headers: { 'X-InkLex-Client': '1' } })).ok()).toBe(true);
  await page.goto('/#/words');
  await page.getByLabel('搜索字词或释义').fill('18虚词');
  await expect(page.locator('.word-card').filter({ has: page.locator('.word-display', { hasText: /^所以$/ }) })).toBeVisible();
  await page.getByLabel('搜索字词或释义').fill('150实词:1376.2');
  await expect(page.locator('.word-card')).toHaveCount(1);
  await page.locator('.word-card').click();
  const example = page.locator('.context-example').filter({ hasText: '150实词:1376.2' });
  await expect(example.locator('.example-prose')).toHaveJSProperty('innerHTML', '故<mark>幸</mark>来告良');
  await expect(example).toContainText('本处释义：幸而');
  await example.locator('xpath=..').getByRole('button', { name: '加入计划', exact: true }).click();
  await expect.poll(async () => Object.keys((await db(page)).cards).length).toBe(1);
  expect((await db(page)).reviews).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
