import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createSeed } from '../src/domain/seed';
import { saveContext } from '../src/domain/model';
import { enroll } from '../src/domain/scheduler';
import { mergeBundledContent } from '../server/content';
import { mergeSupplement } from '../server/supplement';
import { mergeTextbookArticles } from '../server/textbook-articles';

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
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(5);
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
