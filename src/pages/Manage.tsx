import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, BookOpen, Check, Download, Edit3, FilePlus2, FileText, Layers3, Plus, Save, Settings2, Upload, X } from 'lucide-react';
import { Empty, go, Heading, Modal } from '../components';
import { downloadFile, useStore } from '../store';
import { articleCollection, getWord, importLines, occurrences, saveArticle, saveContext, sentenceAt, uid, type Article, type ArticleCollection, type Context, type Database } from '../domain/model';
import { exportText, mergeBackup, parseBackup } from '../domain/storage';
import { localDay } from '../domain/scheduler';

export function ArticleEditor({ article, initialCollection = 'curricular', onClose }: { article?: Article; initialCollection?: ArticleCollection; onClose: () => void }) {
  const { update, notify, data } = useStore();
  const [form, setForm] = useState<Article>(article ? { ...article, collection: articleCollection(article) } : { collection: initialCollection, id: uid(), title: '', author: '', era: '', body: '', summary: '', sample: false });
  const [busy, setBusy] = useState(false);
  const change = (key: keyof Article, value: string) => setForm(f => ({ ...f, [key]: value }));
  const invalidates = article && form.body !== article.body && data.contexts.some(c => c.articleId === article.id);
  return <Modal title={article ? '编辑课文' : '把一篇课文放上书架'} onClose={onClose} wide><form onSubmit={async e => {
    e.preventDefault(); setBusy(true);
    const ok = await update(current => saveArticle(current, { ...form, title: form.title.trim(), body: form.body.trim() }));
    setBusy(false);
    if (ok) { notify(invalidates ? '课文已保存，原有标注已转为待核对。' : '课文已保存，可以开始添加重点词标注。'); onClose(); go(`articles/${form.id}`); }
  }}><div className="form-row"><label>篇名<input required maxLength={120} value={form.title} onChange={e => change('title', e.target.value)} placeholder="例如：小石潭记" /></label><label>作者<input maxLength={80} value={form.author} onChange={e => change('author', e.target.value)} placeholder="例如：柳宗元" /></label><label>朝代<input maxLength={40} value={form.era} onChange={e => change('era', e.target.value)} placeholder="例如：唐" /></label></div><label>所属板块<select value={form.collection} onChange={e => setForm(f => ({ ...f, collection: e.target.value as ArticleCollection }))}><option value="curricular">课文书架</option><option value="extracurricular">课外古诗文</option></select></label><label>一句简介（选填）<input maxLength={300} value={form.summary} onChange={e => change('summary', e.target.value)} placeholder="给这篇文章写一句书签" /></label><label>完整原文<textarea aria-label="完整原文" required className="article-textarea" rows={11} maxLength={100000} value={form.body} onChange={e => change('body', e.target.value)} placeholder="粘贴完整原文，保留段落与诗句分行。保存后可继续标记重点字词。" /></label>{invalidates && <div className="notice"><AlertCircle size={17} /> 原文已修改，现有标注将转为待核对。重新确认位置后才能进入抽背。</div>}<div className="form-footer"><span className="muted small">{form.body.length} 字符 · 原文与标注分开保存</span><button className="button primary" disabled={busy}><Save size={16} /> 保存课文</button></div></form></Modal>;
}

export function ContextEditor({ context, initialArticle, initialSelection, onClose }: { context?: Context; initialArticle?: string; initialSelection?: { word: string; start: number }; onClose: () => void }) {
  const { data, update, notify } = useStore();
  const initialSense = data.senses.find(s => s.id === context?.senseId);
  const articleId = context?.articleId ?? initialArticle ?? '';
  const [articleBody] = useState(() => data.articles.find(a => a.id === articleId)?.body);
  const [word, setWord] = useState(context ? getWord(data, context.senseId) : initialSelection?.word ?? '');
  const [meaning, setMeaning] = useState(context?.gloss ?? '');
  const [text, setText] = useState(context?.text ?? '');
  const [source, setSource] = useState(context?.source ?? '');
  const [position, setPosition] = useState(context?.articleId ? (context.verified ? context.articleStart ?? -1 : -1) : context?.start ?? initialSelection?.start ?? -1);
  const [senseId, setSenseId] = useState(initialSense?.id ?? '');
  const [note, setNote] = useState(initialSense?.note ?? '');
  const [verified, setVerified] = useState(context?.verified ?? true);
  const [busy, setBusy] = useState(false);
  const article = data.articles.find(a => a.id === articleId);
  const material = article ? articleBody ?? article.body : text;
  const positions = occurrences(material, word.trim());
  const effectivePosition = positions.includes(position) ? position : !article && positions.length === 1 ? positions[0] : -1;
  const existing = data.senses.filter(s => data.entries.some(e => e.id === s.entryId && e.word === word.trim()));
  const selection = (start: number, end: number) => {
    if (start === end || end - start > 40) return;
    const selected = material.slice(start, end);
    if (/[\n，。！？；]/.test(selected)) return;
    setWord(selected); setPosition(start); setSenseId('');
  };
  return <Modal title={context ? '编辑字词与语境' : article ? '给原文添一处标注' : '收藏一个字词与例句'} onClose={onClose} wide><form onSubmit={async e => {
    e.preventDefault();
    if (effectivePosition < 0) { notify('请在原文或例句中明确选择要标注的那一处。'); return; }
    const sentence = article ? sentenceAt(material, effectivePosition) : { text, start: effectivePosition };
    setBusy(true);
    const ok = await update(current => {
      if (article && current.articles.find(a => a.id === article.id)?.body !== material) throw new Error('原文已被更新，请关闭标注窗口并重新选择位置。');
      return saveContext(current, { id: context?.id, word, meaning, note, ...sentence,
      existingSenseId: senseId || undefined, articleId: article?.id ?? null, articleStart: article ? effectivePosition : null,
      source: article ? `《${article.title}》` : source, verified });
    });
    setBusy(false);
    if (ok) { notify('字词、释义与例句已保存到字词库。'); onClose(); }
  }}>{article ? <p className="small muted">正在标注《{article.title}》。位置对应你在原文中选中的那一处。</p> : <p className="small muted">零散例句 · 课文标注请在「课文书架」打开原文后编辑。</p>}
    <label>{article ? '原文（可拖选要标注的字词）' : '例句（可拖选要标注的字词）'}<textarea required readOnly={!!article} rows={article ? 6 : 3} className="annotation-textarea" value={material} onChange={e => { setText(e.target.value); setPosition(-1); }} onSelect={e => selection(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)} placeholder="粘贴例句，保留理解词义所需的语境。" /></label>
    <div className="form-row"><label>目标字词<input required maxLength={40} value={word} onChange={e => { setWord(e.target.value); setSenseId(''); setPosition(-1); }} placeholder="例如：顾" /></label><label>标注位置<select aria-label="选择字词出现的位置" value={effectivePosition} onChange={e => setPosition(Number(e.target.value))}><option value={-1}>{positions.length ? '请明确选择一处，或在原文中选中字词' : '请先填入原文中的字词'}</option>{positions.map((p, i) => <option key={p} value={p}>第 {i + 1} 处：{material.slice(Math.max(0, p - 5), p)}【{word}】{material.slice(p + word.length, p + word.length + 8)}</option>)}</select></label></div>
    {!!existing.length && <label>关联义项<select value={senseId} onChange={e => { setSenseId(e.target.value); const s = existing.find(s => s.id === e.target.value); if (s) { setMeaning(s.meaning); setNote(s.note); } }}><option value="">按下面的释义归类，或新建义项</option>{existing.map(s => <option key={s.id} value={s.id}>{word}：{s.meaning}</option>)}</select><small>选择已有义项可共用复习进度；本处释义仍保留你的原始表述。</small></label>}
    <label>本处释义<textarea aria-label="本处释义" required rows={2} maxLength={1000} value={meaning} onChange={e => setMeaning(e.target.value)} placeholder="填写教材或笔记中的释义" /></label>
    {!article && <label>出处（选填）<input maxLength={160} value={source} onChange={e => setSource(e.target.value)} placeholder="例如：《出师表》" /></label>}
    {!senseId && !context && <label>新义项笔记（选填）<input maxLength={3000} value={note} onChange={e => setNote(e.target.value)} placeholder="可记录活用、通假或易混淆的意思" /></label>}
    {effectivePosition >= 0 && <div className="annotation-preview"><span className="eyebrow">标注预览</span><p>{material.slice(Math.max(0, effectivePosition - 14), effectivePosition)}<mark>{word}</mark><span className="inline-gloss">（{meaning || '释义'}）</span>{material.slice(effectivePosition + word.length, effectivePosition + word.length + 24)}</p></div>}
    {context && initialSense?.note && <p className="sense-note">{initialSense.note}</p>}
    <div className="form-footer"><label className="check-label"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> 已核对释义与标注位置</label><button className="button primary" disabled={busy}><Save size={16} /> 保存字词</button></div>
  </form></Modal>;
}

export function Manage({ params }: { params: URLSearchParams }) {
  const { data, update, notify } = useStore();
  const [editor, setEditor] = useState<'article' | 'context' | null>(params.has('article') || params.get('new') === 'article' ? 'article' : params.has('context') || params.has('annotate') || params.get('new') === 'context' ? 'context' : null);
  const [articleId, setArticleId] = useState<string | undefined>(params.get('article') ?? undefined);
  const [contextId, setContextId] = useState<string | undefined>(params.get('context') ?? undefined);
  const [annotateId, setAnnotateId] = useState<string | undefined>(params.get('annotate') ?? undefined);
  const [bulk, setBulk] = useState('');
  const [dailyNew, setDailyNew] = useState(data.settings.dailyNew);
  const [retention, setRetention] = useState(Math.round(data.settings.retention * 100));
  const [backup, setBackup] = useState<Database | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const pending = data.contexts.filter(c => !c.verified);
  useEffect(() => { setDailyNew(data.settings.dailyNew); setRetention(Math.round(data.settings.retention * 100)); }, [data.settings.dailyNew, data.settings.retention]);
  useEffect(() => {
    const linked = data.contexts.find(c => c.id === params.get('context'));
    if (linked?.articleId) go(`articles/${linked.articleId}?context=${linked.id}`);
    else if (params.has('annotate')) go(`articles/${params.get('annotate')}?annotate=1`);
    else if (params.has('article')) go(`articles/${params.get('article')}?edit=1`);
  }, [params, data.contexts]);
  const editArticle = (id?: string) => { setArticleId(id); setEditor('article'); };
  const editContext = (id?: string, article?: string) => {
    const context = data.contexts.find(c => c.id === id);
    const target = context?.articleId ?? article;
    if (target) { go(`articles/${target}?${context ? `context=${context.id}` : 'annotate=1'}`); return; }
    setContextId(id); setAnnotateId(undefined); setEditor('context');
  };
  const exportBackup = () => { downloadFile(exportText(data), `inklex-backup-${localDay(new Date())}.json`); notify('完整备份已生成，包含资料、复习安排与历史记录。'); };
  return <><Heading eyebrow="YOUR PERSONAL COLLECTION" title="把好文字，慢慢收进来。" subtitle="整理原文与释义，照顾好自己的学习节奏。" action={<button className="button" onClick={exportBackup}><Download size={16} /> 导出完整备份</button>} />
    <div className="manage-actions"><button className="action-card" onClick={() => editArticle()}><span className="action-icon"><FilePlus2 size={24} /></span><div><h3>添加一篇课文</h3><p>保存全文，再为重点字词添加标注。</p></div><Plus size={18} /></button><button className="action-card" onClick={() => editContext()}><span className="action-icon warm"><Layers3 size={24} /></span><div><h3>添加字词与例句</h3><p>一个字、一种意思、一句具体的语境。</p></div><Plus size={18} /></button></div>
    {pending.length > 0 && <section className="paper-card pending-list"><div className="section-heading compact"><h2><AlertCircle size={18} /> 待核对材料</h2><span className="badge warm">{pending.length} 条</span></div><p className="small muted">这些内容暂不进入正式复习。确认字词位置和释义后即可启用。</p>{pending.map(c => <div className="manage-row" key={c.id}><span className="word-mini">{getWord(data, c.senseId)}</span><div><strong>{c.source || '零散例句'}</strong><small>{c.gloss}</small></div><button className="button small-button" onClick={() => editContext(c.id)}>核对与编辑</button></div>)}</section>}
    <div className="manage-columns"><div><section className="paper-card"><div className="section-heading compact"><h2><BookOpen size={18} /> 我的课文资料</h2><span className="muted small">{data.articles.length} 篇</span></div>{data.articles.map(a => <div className="manage-row" key={a.id}><span className="document-icon"><FileText size={20} /></span><div><strong>{a.title}{a.sample && <span className="badge">示例</span>}</strong><small>{a.author || '作者待补'} · {data.contexts.filter(c => c.articleId === a.id).length} 处标注</small></div><button className="text-button" onClick={() => editContext(undefined, a.id)}>标注</button><button className="icon-button" aria-label={`编辑${a.title}`} onClick={() => go(`articles/${a.id}?edit=1`)}><Edit3 size={16} /></button></div>)}{!data.articles.length && <Empty title="从第一篇文章开始" description="添加后即可在全文中标注重点字词。" />}</section>
    <section className="paper-card bulk-card"><div className="section-heading compact"><h2><Layers3 size={18} /> 批量整理零散例句</h2></div><p className="small muted">可从表格复制，每行一条，列之间用 Tab 分隔。</p><div className="format-label">字词 → 释义 → 例句 → 出处（选填）→ 第几次出现（默认 1）</div><textarea rows={6} aria-label="批量例句资料" value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'绝\t独一无二\t奇山异水，天下独绝。\t《与朱元思书》\t1'} /><div className="form-footer"><button className="text-button" onClick={() => setBulk('绝\t独一无二\t奇山异水，天下独绝。\t《与朱元思书》\t1')}>填入格式示例</button><button className="button" disabled={busy || !bulk.trim()} onClick={async () => { setBusy(true); const ok = await update(current => importLines(current, bulk)); setBusy(false); if (ok) { notify('整批资料已保存到字词库。'); setBulk(''); } }}><Plus size={15} /> 导入例句</button></div><p className="micro">任一行有问题时会标出行号，整批修正后再保存。</p></section></div>
    <aside><section className="paper-card settings-card"><div className="section-heading compact"><h2><Settings2 size={18} /> 学习节奏</h2><span className="badge">FSRS-6</span></div><form onSubmit={async e => { e.preventDefault(); if (await update(current => ({ ...current, settings: { dailyNew, retention: retention / 100 } }))) notify('学习设置已保存，新评分将使用新的目标保持率。'); }}><label>每日新增义项<div className="number-input"><input type="number" min={0} max={100} required value={dailyNew} onChange={e => setDailyNew(e.target.value === '' ? 0 : Number(e.target.value))} /><span>个 / 天</span></div><small>设为 0 可以暂停新增，继续复习旧词。</small></label><label>目标保持率<div className="retention-display"><strong>{retention}<small>%</small></strong><span>建议从 90% 开始</span></div><input type="range" min={70} max={97} value={retention} onChange={e => setRetention(Number(e.target.value))} /><small>目标越高，通常需要更频繁地复习。已有任务保留到期时间，后续评分采用新设置。</small></label><button className="button primary full"><Check size={15} /> 保存学习设置</button></form></section>
    <section className="paper-card backup-card"><span className="eyebrow">KEEP YOUR PROGRESS</span><h2>积累，已经自动保存。</h2><p>资料与进度自动保存在运行服务的电脑上，并保留每日备份。同一服务下，更换浏览器也能继续学习。</p><button className="button full" onClick={exportBackup}><Download size={16} /> 导出备份</button><label className="button full upload-button"><Upload size={16} /> 导入或恢复备份<input type="file" accept=".json,application/json" hidden aria-label="导入备份文件" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { if (file.size > 15_000_000) throw new Error('请选择小于 15 MB 的 InkLex 备份。'); setBackup(parseBackup(await file.text())); setImportMode('merge'); } catch (error) { notify(error instanceof Error ? error.message : '文件读取失败'); } }} /></label><p className="micro">也可手动导出，用于迁移服务或额外留存。包含完整资料与复习记录。</p></section></aside></div>
    {editor === 'article' && <ArticleEditor article={data.articles.find(a => a.id === articleId)} onClose={() => setEditor(null)} />}
    {editor === 'context' && <ContextEditor context={data.contexts.find(c => c.id === contextId)} initialArticle={annotateId} onClose={() => setEditor(null)} />}
    {backup && <Modal title="导入学习资料" onClose={() => setBackup(null)}><p>文件包含 {backup.articles.length} 篇课文、{backup.entries.length} 个字词和 {backup.reviews.length} 条复习记录。</p><label className="import-option"><input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /><span><strong>合并新增资料</strong><small>相同内容自动去重，已有义项的当前复习进度保留。</small></span></label><label className="import-option"><input type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /><span><strong>完整恢复这份备份</strong><small>替换当前资料和进度，恢复前会自动下载一份当前备份。</small></span></label><div className="form-footer"><button className="button" onClick={() => setBackup(null)}>取消</button><button className="button primary" disabled={busy} onClick={async () => { setBusy(true); const ok = await update(current => { if (importMode === 'replace') { downloadFile(exportText(current), `inklex-before-restore-${localDay(new Date())}.json`); return backup; } return mergeBackup(current, backup); }); setBusy(false); if (ok) { notify(importMode === 'merge' ? '资料已合并，已有复习进度保留。' : '备份已完整恢复。'); setBackup(null); } }}>确认{importMode === 'merge' ? '合并' : '恢复'}<ArrowRight size={15} /></button></div></Modal>}
  </>;
}
