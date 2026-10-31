import { useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Edit3, EyeOff, ListPlus, Minus, Plus, Search } from 'lucide-react';
import { ArticleCard, Empty, go, Heading } from '../components';
import { useStore } from '../store';
import { getWord, uid, type Context } from '../domain/model';
import { enroll } from '../domain/scheduler';
import { ArticleEditor, ContextEditor } from './Manage';

export function Articles() {
  const { data } = useStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const articles = data.articles.filter(a => `${a.title}${a.author}${a.body}`.includes(search.trim()) && (filter === 'all' || data.contexts.some(c => c.articleId === a.id && (filter === 'planned' ? data.cards[c.senseId] : !c.verified))));
  return <><Heading eyebrow="THE READING ROOM" title="一篇原文，一方天地。" subtitle="在字里行间理解词义，让每个字都有它的来处。" action={<button className="button primary" onClick={() => setAdding(true)}><Plus size={16} /> 添加课文</button>} />
    <div className="toolbar"><div className="tabs">{[['all', '全部课文'], ['planned', '已加入计划'], ['pending', '待核对标注']].map(([key, label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div><label className="search-field"><Search size={17} /><input aria-label="搜索课文" placeholder="搜索篇名、作者或原文…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    <div className="shelf-label"><span>{articles.length} 篇文章</span><span>点击篇目，开始全文学习</span></div><div className="article-grid">{articles.map((a, i) => <ArticleCard key={a.id} article={a} index={i} />)}</div>{!articles.length && <Empty title="这里还没有匹配的文章" description="试试其他关键词，或添加自己的课文。" />}
    {data.articles.some(a => a.sample) && <p className="sample-notice">书架附有示例课文与释义，打开后可编辑原文与标注。正式学习时请按你的教材核对。</p>}
    {adding && <ArticleEditor onClose={() => setAdding(false)} />}
  </>;
}
export function Reader({ articleId, params }: { articleId: string; params: URLSearchParams }) {
  const { data, update, notify } = useStore();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [fontSize, setFontSize] = useState(22);
  const [busy, setBusy] = useState(false);
  const [annotating, setAnnotating] = useState(params.has('annotate') || params.has('context'));
  const [editingArticle, setEditingArticle] = useState(params.has('edit'));
  const [editingContext, setEditingContext] = useState<string | null>(params.get('context'));
  const [selection, setSelection] = useState<{ word: string; start: number } | null>(null);
  const [group, setGroup] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const article = data.articles.find(a => a.id === articleId);
  const contexts = data.contexts.filter(c => c.articleId === articleId && c.verified).sort((a, b) => a.articleStart! - b.articleStart!);
  const senseIds = [...new Set(contexts.map(c => c.senseId))];
  const [selected, setSelected] = useState<string[]>(senseIds);
  const pending = data.contexts.filter(c => c.articleId === articleId && !c.verified).length;
  if (!article) return <Empty title="找不到这篇课文" description="它可能尚未导入到当前浏览器。"><button className="button" onClick={() => go('articles')}>回到书架</button></Empty>;
  const toggle = (context: Context) => {
    const opening = !opened.has(context.id);
    setOpened(old => { const next = new Set(old); if (opening) next.add(context.id); else next.delete(context.id); return next; });
    if (opening) void update(current => ({ ...current, contexts: current.contexts.map(c => c.id === context.id ? { ...c, learned: true } : c), readings: [...current.readings, { id: uid(), contextId: context.id, time: new Date().toISOString() }] }));
  };
  const add = async (review = false) => {
    if (!selected.length) { notify('先选择要学习的义项。'); return; }
    setBusy(true);
    const ok = await update(current => enroll(current, selected));
    setBusy(false);
    if (ok) { if (review) go(`review?article=${article.id}`); else notify('已加入学习计划，原有进度已保留。'); }
  };
  const pick = (start: number, length: number) => {
    if (group && anchor === null) { setAnchor(start); return; }
    const from = group ? Math.min(anchor!, start) : start;
    const end = group ? Math.max(anchor!, start) + (start >= anchor! ? length : [...article.body.slice(anchor!)][0].length) : start + length;
    const word = article.body.slice(from, end);
    setAnchor(null);
    if (word.length > 40 || /[\s，。！？；、：]/.test(word)) { notify('请选中同一句里的连续字词，最多 40 个字符。'); return; }
    const overlap = contexts.find(c => c.articleStart! < end && c.articleStart! + getWord(data, c.senseId).length > from);
    if (overlap) {
      if (!group || (overlap.articleStart === from && getWord(data, overlap.senseId) === word)) setEditingContext(overlap.id);
      else notify('选中范围与已有标注重叠，请先点击已有标注编辑。');
    } else setSelection({ word, start: from });
  };
  let offset = 0;
  const editableText = annotating ? [...article.body].map(char => {
    const start = offset; offset += char.length;
    if (!/[\p{L}\p{N}]/u.test(char)) return <span key={start}>{char}</span>;
    const marked = contexts.some(c => start >= c.articleStart! && start < c.articleStart! + getWord(data, c.senseId).length);
    return <button key={start} className={`annotation-char ${marked ? 'marked' : ''} ${anchor === start ? 'selected' : ''}`} aria-label={`标注第 ${start + 1} 字「${char}」`} onClick={() => pick(start, char.length)}>{char}</button>;
  }) : null;
  let cursor = 0;
  const fragments = contexts.map(context => {
    const before = article.body.slice(cursor, context.articleStart!);
    const word = getWord(data, context.senseId);
    cursor = context.articleStart! + word.length;
    return <span key={context.id}>{before}<button id={`word-${context.id}`} className={`word-token ${opened.has(context.id) ? 'is-open' : ''}`} aria-label={`查看「${word}」的释义`} aria-expanded={opened.has(context.id)} onClick={() => toggle(context)}>{word}</button>{opened.has(context.id) && <span className="inline-gloss">（{context.gloss}）</span>}</span>;
  });
  return <><div className="reader-top"><button className="text-button" onClick={() => go('articles')}><ArrowLeft size={16} /> 返回课文书架</button><div className="button-row"><button className="button small-button" onClick={() => { setAnnotating(v => !v); setAnchor(null); }}>{annotating ? '完成标注' : '编辑标注'}</button><button className="text-button" onClick={() => setEditingArticle(true)}><Edit3 size={14} /> 编辑课文</button></div></div>
    <div className="reader-layout"><section className="reading-paper"><div className="reader-paper-heading"><span className="eyebrow">{article.era || '古诗文'} · {article.author || '佚名'}</span><h1>{article.title}</h1><div className="paper-divider"><span /><BookOpen size={17} /><span /></div><p>{annotating ? '在原文中编辑每一处字词的释义' : '点击标记字词，在原文中查看释义'}</p></div><div className="reader-tools"><span>{contexts.length} 处标注{article.sample ? ' · 示例课文' : ''}</span><div><button className="icon-button" aria-label="减小字号" disabled={fontSize <= 18} onClick={() => setFontSize(s => s - 2)}><Minus size={14} /></button><span>字</span><button className="icon-button" aria-label="增大字号" disabled={fontSize >= 30} onClick={() => setFontSize(s => s + 2)}><Plus size={14} /></button><button className="text-button" onClick={() => setOpened(new Set())}><EyeOff size={14} /> 收起全部</button></div></div>
      {annotating && <div className="annotation-tools"><p>点击原文中具体的字，添加或修改这一处释义。绿色下划线表示已有标注。</p><label className="check-label"><input type="checkbox" checked={group} onChange={e => { setGroup(e.target.checked); setAnchor(null); }} /> 选择词组（依次点击起字、止字）</label>{anchor !== null && <p role="status">已选起字「{article.body.slice(anchor, anchor + [...article.body.slice(anchor)][0].length)}」，请点击词组的止字。<button className="text-button" onClick={() => setAnchor(null)}>重新选择</button></p>}</div>}
      <div className={`reader-prose ${annotating ? 'annotation-prose' : ''}`} style={{ fontSize }}>{annotating ? editableText : <>{fragments}{article.body.slice(cursor)}</>}</div><div className="reader-end"><span />读有所思，习有所得<span /></div>
      {!!pending && <div className="notice">有 {pending} 处标注需要重新确认位置和释义。<button className="text-button" onClick={() => setAnnotating(true)}>在本篇核对 <ArrowRight size={14} /></button></div>}
      {annotating && data.contexts.filter(c => c.articleId === article.id && !c.verified).map(c => <div className="manage-row" key={c.id}><span className="word-mini">{getWord(data, c.senseId)}</span><div><strong>{c.gloss}</strong><small>{c.text}</small></div><button className="button small-button" onClick={() => setEditingContext(c.id)}>重新定位与核对</button></div>)}
    </section><aside className="reader-aside"><section className="paper-card"><div className="spread"><h2>本篇字词</h2><span className="badge">{senseIds.length} 个义项</span></div><p className="muted small">选择你想加入计划的重点词。</p><div className="selection-actions"><button className="text-button" onClick={() => setSelected(selected.length === senseIds.length ? [] : senseIds)}>{selected.length === senseIds.length ? '取消全选' : '选择全部'}</button><button className="text-button" onClick={() => { setAnnotating(true); setAnchor(null); }}><Plus size={13} /> 添加标注</button></div><div className="word-checklist">{senseIds.map(id => { const context = contexts.find(c => c.senseId === id)!; return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={e => setSelected(list => e.target.checked ? [...list, id] : list.filter(s => s !== id))} /><span className="check-word">{getWord(data, id)}</span><span className="muted">{data.cards[id] ? <><Check size={12} /> 已在计划</> : '未加入'}</span><button type="button" className="icon-button" aria-label={`定位「${getWord(data, id)}」`} onClick={e => { e.preventDefault(); document.getElementById(`word-${context.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><ChevronDown size={14} /></button></label>; })}</div><button className="button full" disabled={busy || !selected.length} onClick={() => void add()}><ListPlus size={16} /> 加入学习计划</button><button className="button primary full" disabled={busy || !selected.length} onClick={() => void add(true)}>开始本篇抽背 <ArrowRight size={16} /></button></section><div className="reading-tip"><span className="eyebrow">读 · 思 · 忆</span><p>先试着想一想，<br />再点开那个字。</p><span>查阅释义记为阅读，抽背自评用于安排下次复习。</span></div></aside></div>
    {editingArticle && <ArticleEditor article={article} onClose={() => setEditingArticle(false)} />}
    {(selection || editingContext) && <ContextEditor context={data.contexts.find(c => c.id === editingContext && c.articleId === article.id)} initialArticle={article.id} initialSelection={selection ?? undefined} onClose={() => { setSelection(null); setEditingContext(null); }} />}
  </>;
}
