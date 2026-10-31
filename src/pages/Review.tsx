import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Clock3, RotateCcw, Search, Shuffle, Sparkles, X } from 'lucide-react';
import { Empty, go, Heading } from '../components';
import { useStore } from '../store';
import { articleCollection, contextsFor, getWord, type ArticleCollection, type Grade } from '../domain/model';
import { chooseContext, dailyStats, gradeContext, intervalLabel, previewGrades, studyQueue } from '../domain/scheduler';

const ratings: { grade: Grade; title: string; subtitle: string; className: string }[] = [
  { grade: 1, title: '忘记了', subtitle: '没想起来或答错', className: 'again' },
  { grade: 2, title: '有点吃力', subtitle: '想了很久才记起', className: 'hard' },
  { grade: 3, title: '记得', subtitle: '能够正常回忆', className: 'good' },
  { grade: 4, title: '很熟练', subtitle: '迅速而确定', className: 'easy' },
];
type Question = { senseId: string; contextId: string };
function shuffle<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function ReviewPage({ initialArticle }: { initialArticle: string | null }) {
  const { data, now, update, notify } = useStore();
  const [mode, setMode] = useState<'scheduled' | 'practice'>('scheduled');
  const [articleIds, setArticleIds] = useState<string[]>(initialArticle ? [initialArticle] : []);
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState<'all' | ArticleCollection>('all');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(10);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [preview, setPreview] = useState<Record<number, string>>({});
  const [completed, setCompleted] = useState<Grade[]>([]);
  const stats = dailyStats(data, now);
  const matchedArticles = data.articles.filter(a => (collection === 'all' || articleCollection(a) === collection) && `${a.title} ${a.author} ${a.summary}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const narrowed = collection !== 'all' || search.trim().length > 0;
  const scopeIds = articleIds.length ? articleIds : narrowed ? matchedArticles.map(a => a.id) : [];
  const emptyScope = narrowed && !scopeIds.length;
  const dueIds = emptyScope ? [] : studyQueue(data, now, scopeIds);
  const pool = emptyScope ? [] : data.senses.filter(s => contextsFor(data, s.id, scopeIds).length && (filter === 'all' || (filter === 'learned' ? data.cards[s.id]?.state > 0 : data.reviews.some(r => r.senseId === s.id && r.grade === 1)))).map(s => s.id);
  const question = questions?.[index];
  const context = data.contexts.find(c => c.id === question?.contextId);
  const word = question ? getWord(data, question.senseId) : '';
  const article = context?.articleId ? data.articles.find(a => a.id === context.articleId) : null;
  const finish = questions !== null && index >= questions.length;
  useEffect(() => {
    let live = true;
    setPreview({});
    if (question && mode === 'scheduled') previewGrades(data, question.senseId, now).then(values => { if (live) setPreview(values); }).catch(() => { if (live) notify('间隔预览暂时不可用，评分时会重新计算。'); });
    return () => { live = false; };
  }, [question?.contextId, mode, now, data.settings.retention]);
  const start = () => {
    const ids = mode === 'scheduled' ? dueIds : shuffle(pool).slice(0, limit);
    const selected = ids.flatMap(id => {
      const c = mode === 'scheduled' ? chooseContext(data, id, scopeIds) : shuffle(contextsFor(data, id, scopeIds))[0];
      return c ? [{ senseId: id, contextId: c.id }] : [];
    });
    if (!selected.length) { notify(mode === 'scheduled' ? '当前范围没有可开始的任务，可以选择其他范围或调整每日新增量。' : '这个范围暂时没有已核对的例句。'); return; }
    setQuestions(selected); setIndex(0); setRevealed(false); setCompleted([]);
  };
  const grade = async (value: Grade) => {
    if (!question || !revealed || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let nextDue = '';
    const ok = await update(async current => {
      const next = await gradeContext(current, question.contextId, value, mode);
      nextDue = next.cards[question.senseId]?.dueAt ?? '';
      return next;
    });
    if (ok) {
      setCompleted(values => [...values, value]); setIndex(i => i + 1); setRevealed(false);
      if (mode === 'scheduled') notify(`已记录 · ${intervalLabel(nextDue)}再复习`);
    }
    busyRef.current = false; setBusy(false);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!question || busy || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.code === 'Space' && !revealed) { e.preventDefault(); setRevealed(true); }
      else if (revealed && /^[1-4]$/.test(e.key)) void grade(Number(e.key) as Grade);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  if (questions) return <div className="recall-session"><div className="session-header"><button className="text-button" onClick={() => { setQuestions(null); setRevealed(false); }} disabled={busy}><ArrowLeft size={16} /> {finish ? '返回抽背设置' : '退出本轮'}</button><span>{mode === 'scheduled' ? '今日复习' : '自选抽背'} · {Math.min(index + 1, questions.length)} / {questions.length}</span><span className="badge">{mode === 'scheduled' ? '间隔复习' : '自由练习'}</span></div><div className="session-progress"><i style={{ width: `${index / questions.length * 100}%` }} /></div>
    {finish ? <section className="session-finish paper-card"><span className="finish-icon"><Check size={32} /></span><span className="eyebrow">A LITTLE MORE REMEMBERED</span><h1>这一次，记得更清楚了。</h1><p>本轮完成 {completed.length} 次回忆，其中 {completed.filter(g => g > 1).length} 次成功想起。</p><div className="finish-metrics"><div><strong>{completed.filter(g => g === 1).length}</strong><span>需要再巩固</span></div><div><strong>{stats.due}</strong><span>当前到期待复习</span></div><div><strong>{stats.later}</strong><span>今天稍后再复习</span></div></div><p className="muted">{mode === 'scheduled' ? '每个义项的下一次复习时间都已更新，稍后到期的任务会重新出现。' : '本轮练习已记录，正式复习计划继续保留。'}</p><div className="button-row center"><button className="button" onClick={() => go('today')}>回到今日学习</button><button className="button primary" onClick={() => setQuestions(null)}><RotateCcw size={16} /> 再看一轮安排</button></div></section> : context && question ? <>
      <section className="recall-paper"><span className="eyebrow">{data.cards[question.senseId]?.state === 0 && mode === 'scheduled' ? '初次学习 · 先尝试回忆' : '想一想，它在这里是什么意思'}</span><div className="question-source">{context.source || '我的例句'}</div><p className="question-sentence">{context.text.slice(0, context.start)}<mark>{word}</mark>{revealed && <span className="inline-gloss">（{context.gloss}）</span>}{context.text.slice(context.start + word.length)}</p>
      {revealed ? <div className="answer-block"><span className="eyebrow">本处释义</span><p><strong>{word}</strong><span>{context.gloss}</span></p>{data.senses.find(s => s.id === question.senseId)?.note && <small>{data.senses.find(s => s.id === question.senseId)?.note}</small>}</div> : <div className="recall-prompt"><CircleHelp size={17} /><span>先在心里或口头回答，再核对释义。</span></div>}
      {article && <details className="context-expand"><summary>查看完整上下文</summary><p>{article.body}</p></details>}
      </section>
      {revealed ? <div className="rating-area"><p>这一次，你记得怎么样？</p><div className="rating-grid">{ratings.map(r => <button key={r.grade} disabled={busy} className={`rating-button ${r.className}`} onClick={() => void grade(r.grade)}><kbd>{r.grade}</kbd><strong>{r.title}</strong><span>{mode === 'scheduled' && preview[r.grade] ? intervalLabel(preview[r.grade], now) : r.subtitle}</span></button>)}</div><span className="micro">如实反馈，让下一次复习安排更适合你。</span></div> : <div className="reveal-area"><button className="button primary reveal-button" onClick={() => setRevealed(true)}>查看释义 <ArrowRight size={18} /></button><span className="micro">也可以按空格键展开</span></div>}
    </> : <Empty title="这条材料已发生变化" description="返回抽背设置，重新生成本轮题目。"><button className="button" onClick={() => setQuestions(null)}>返回</button></Empty>}
  </div>;

  return <><Heading eyebrow="RECALL, THEN REMEMBER" title="让记忆，再清晰一点。" subtitle="先回忆，再核对。每一次认真想起，都是在巩固。" />
    <div className="review-setup-layout"><section className="paper-card review-setup"><div className="mode-switch"><button className={mode === 'scheduled' ? 'selected' : ''} onClick={() => setMode('scheduled')}><Clock3 size={18} /> 今日复习<span>按记忆安排</span></button><button className={mode === 'practice' ? 'selected' : ''} onClick={() => setMode('practice')}><Shuffle size={18} /> 自选抽背<span>按范围练习</span></button></div>
      <div className="form-section"><h3>这次，想复习哪些内容？</h3><p className="muted small">{mode === 'scheduled' ? '在所选范围中，优先复习到期义项，再学习新义项。' : '选定范围后随机出题，每个义项在一轮中出现一次。'}</p><div className="review-scope-search"><label className="search-field"><Search size={17} /><input aria-label="搜索复习篇目" placeholder="搜索篇名、作者或册次…" value={search} onChange={e => { setSearch(e.target.value); setArticleIds([]); }} /></label>{search && <button className="text-button" onClick={() => { setSearch(''); setArticleIds([]); }}>清空搜索</button>}</div>
        <div className="scope-tags" role="group" aria-label="复习篇目标签">{([['all', '全部'], ['curricular', '课内'], ['extracurricular', '课外']] as const).map(([key, label]) => <button key={key} className={`scope-chip ${collection === key ? 'selected' : ''}`} aria-pressed={collection === key} onClick={() => { if (collection !== key) { setCollection(key); setArticleIds([]); } }}>{label}</button>)}</div>
        <p className="muted small scope-summary" aria-live="polite">{articleIds.length ? `已选 ${articleIds.length} 篇` : narrowed ? `当前范围：筛选出的 ${matchedArticles.length} 篇` : '当前范围：全部资料（含独立例句）'} · 可点选篇目缩小范围</p>
        <div className="scope-options"><button className={`scope-chip ${!articleIds.length ? 'selected' : ''}`} aria-pressed={!articleIds.length} disabled={emptyScope} onClick={() => setArticleIds([])}>{narrowed ? '全部筛选结果' : '全部资料'}</button>{matchedArticles.map(a => <button key={a.id} className={`scope-chip ${articleIds.includes(a.id) ? 'selected' : ''}`} aria-pressed={articleIds.includes(a.id)} onClick={() => setArticleIds(ids => ids.includes(a.id) ? ids.filter(id => id !== a.id) : [...ids, a.id])}>{a.title}<span className="scope-article-tag">{articleCollection(a) === 'curricular' ? '课内' : '课外'}</span>{articleIds.includes(a.id) && <Check size={13} />}</button>)}</div>
        {!matchedArticles.length && <p className="muted small">没有匹配的篇目，试试其他关键词或标签。</p>}</div>
      {mode === 'practice' && <div className="form-row"><label>字词范围<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部已核对义项</option><option value="learned">已经学过</option><option value="difficult">曾经忘记</option></select></label><label>本轮题量<select value={limit} onChange={e => setLimit(Number(e.target.value))}>{[5, 10, 20, 50].map(n => <option key={n} value={n}>{n} 题</option>)}</select></label></div>}
      <div className="session-preview"><div><span className="eyebrow">本轮可学习</span><p><strong>{mode === 'scheduled' ? dueIds.length : Math.min(pool.length, limit)}</strong> 个义项</p></div><Sparkles size={30} strokeWidth={1.1} /></div>
      <button className="button primary full big" disabled={mode === 'scheduled' ? !dueIds.length : !pool.length} onClick={start}>{mode === 'scheduled' ? '开始今日复习' : '开始随机抽背'}<ArrowRight size={18} /></button>
      <p className="micro center-text">{mode === 'scheduled' ? '完成自评后更新复习安排。中途离开，已完成进度会保留。' : '练习单独记录，原有正式复习计划继续保留。'}</p>
      {mode === 'scheduled' && !dueIds.length && <div className="notice"><span>{stats.fresh ? '今天的新增量可能已用完，也可以调整范围或到设置中修改新增量。' : stats.later ? '下一批任务尚未到期，稍后再来，或切换自选抽背。' : '先从课文或字词库中，把想学的义项加入计划。'}</span><button className="text-button" onClick={() => go(stats.fresh ? 'manage' : 'articles')}>{stats.fresh ? '调整设置' : '去课文书架'}<ArrowRight size={14} /></button></div>}
    </section><aside><section className="paper-card review-method"><span className="eyebrow">有节奏地温故</span><h2>适合你的<br />记忆间隔。</h2><p>FSRS 根据每次回忆表现，计算下一次复习时间。</p><div className="method-step"><i>01</i><div><strong>先回忆，再看答案</strong><p>给自己主动想起的机会。</p></div></div><div className="method-step"><i>02</i><div><strong>如实反馈掌握程度</strong><p>忘记很正常，再巩固就好。</p></div></div><div className="method-step"><i>03</i><div><strong>按计划，再见一面</strong><p>记得越稳，间隔逐渐拉长。</p></div></div><div className="target-row"><span>目标保持率</span><strong>{Math.round(data.settings.retention * 100)}%</strong></div></section><div className="reading-tip"><p>温习旧知，<br />也给新知留一点位置。</p><span>当前每日新增上限 {data.settings.dailyNew} 个义项，可在资料与设置中调整。</span></div></aside></div>
  </>;
}
