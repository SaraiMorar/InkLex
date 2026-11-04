import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock3, ListPlus, NotebookPen, Search, Shuffle } from 'lucide-react';
import { Empty, go, Heading } from '../components';
import { useStore } from '../store';
import { type Grade, type RecitationQuestion } from '../domain/model';
import { checkRecitationAnswer, enrollRecitations, gradeRecitation, previewRecitation, recitationQueue, recitationReady, recitationState, recitationStats } from '../domain/recitation';
import { intervalLabel } from '../domain/scheduler';

const ratings: { grade: Grade; title: string; className: string }[] = [
  { grade: 1, title: '忘记了', className: 'again' }, { grade: 2, title: '有点吃力', className: 'hard' },
  { grade: 3, title: '记得', className: 'good' }, { grade: 4, title: '很熟练', className: 'easy' },
];
const shuffle = <T,>(items: T[]) => { const rows = [...items]; for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; } return rows; };
type Session = { ids: string[]; index: number; mode: 'practice' | 'scheduled'; grades: Grade[] };

function Answers({ question }: { question: RecitationQuestion }) {
  return <div className="recitation-reference">{question.answers.map((answer, index) => <p key={index}><span>{index + 1}</span>{answer}</p>)}{question.note && <small>{question.note}</small>}</div>;
}

export function RecitationPage() {
  const { data, now, update, notify } = useStore();
  const state = recitationState(data), stats = recitationStats(data, now);
  const [view, setView] = useState<'bank' | 'practice' | 'scheduled'>('bank');
  const [work, setWork] = useState('all'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(10), [random, setRandom] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [responses, setResponses] = useState<string[]>([]), [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState<Record<number, string>>({}), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const works = [...new Set(state.questions.map(question => question.work))];
  const forgotten = new Set(state.reviews.filter(review => review.grade === 1).map(review => review.questionId));
  const matched = state.questions.filter(question => (work === 'all' || question.work === work)
    && `${question.work}${question.author}${question.prompt}`.includes(search.trim())
    && (filter === 'all' || (filter === 'planned' ? !!state.cards[question.id] : forgotten.has(question.id))));
  const queue = recitationQueue(data, now, matched.map(question => question.id));
  const question = state.questions.find(question => question.id === session?.ids[session.index]);
  const finish = !!session && session.index >= session.ids.length;

  useEffect(() => {
    let live = true; setPreview({});
    if (question && session?.mode === 'scheduled') void previewRecitation(data, question.id, now).then(value => { if (live) setPreview(value); }).catch(() => {});
    return () => { live = false; };
  }, [question?.id, session?.mode, data, now]);

  const start = (mode: Session['mode'], single?: string) => {
    const ids = single ? [single] : mode === 'scheduled' ? queue : (random ? shuffle(matched) : matched).slice(0, limit).map(question => question.id);
    if (!ids.length) { notify(mode === 'scheduled' ? '当前范围没有可开始的默写任务。先加入计划，或稍后再来。' : '没有匹配的默写题，请调整筛选。'); return; }
    setSession({ ids, index: 0, mode, grades: [] }); setResponses([]); setRevealed(false); window.scrollTo(0, 0);
  };
  const plan = async (ids: string[]) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const ok = await update(current => enrollRecitations(current, ids));
    if (ok) notify('已加入默写计划，已有复习进度继续保留。');
    busyRef.current = false; setBusy(false);
  };
  const grade = async (value: Grade) => {
    if (!session || !question || !revealed || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let due = '', skipped = false;
    const ok = await update(async current => {
      const at = new Date();
      if (session.mode === 'scheduled' && !recitationReady(current, question.id, at)) { skipped = true; return current; }
      const next = await gradeRecitation(current, question.id, value, session.mode, question.answers.map((_, index) => responses[index] ?? ''), at);
      due = next.recitation?.cards[question.id]?.dueAt ?? '';
      return next;
    });
    if (ok) {
      setSession(current => current ? { ...current, index: current.index + 1, grades: skipped ? current.grades : [...current.grades, value] } : null);
      setResponses([]); setRevealed(false);
      notify(skipped ? '本题已在其他窗口完成或暂不可复习，已跳过。' : session.mode === 'scheduled' ? `已保存 · ${intervalLabel(due)}再复习` : '本次抽背已记录。');
    }
    busyRef.current = false; setBusy(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!question || busy || event.isComposing || /INPUT|TEXTAREA|SELECT|BUTTON/.test((event.target as HTMLElement).tagName)) return;
      if (event.code === 'Space' && !revealed) { event.preventDefault(); setRevealed(true); }
      else if (revealed && /^[1-4]$/.test(event.key)) void grade(Number(event.key) as Grade);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  if (session) return <div className="recall-session recitation-session">
    <div className="session-header"><button className="text-button" disabled={busy} onClick={() => setSession(null)}><ArrowLeft size={16} /> 返回默写题库</button><span>{session.mode === 'scheduled' ? '默写今日复习' : '默写自由抽背'} · {Math.min(session.index + 1, session.ids.length)} / {session.ids.length}</span></div>
    <div className="session-progress"><i style={{ width: `${session.index / session.ids.length * 100}%` }} /></div>
    {finish ? <section className="paper-card session-finish"><span className="finish-icon"><Check size={32} /></span><h1>这一轮，又记牢了一些。</h1><p>已完成 {session.grades.length} 道，其中 {session.grades.filter(grade => grade > 1).length} 道成功想起。</p><p>{session.mode === 'scheduled' ? '复习进度和下一次安排已保存；忘记的题会按计划再次出现。' : '自由抽背记录已保存，正式默写计划继续保留。'}</p><button className="button primary" onClick={() => setSession(null)}>回到理解性默写 <ArrowRight size={16} /></button></section>
      : question ? <><section className="recall-paper recitation-paper"><div className="spread"><span className="eyebrow">理解题意 · 回忆原句</span><span className="badge">《{question.work}》第 {question.number} 题</span></div><h1 className="recitation-prompt">{question.prompt}</h1>
        <p className="muted small">可以输入默写，也可以先在心里或口头背出，再查看答案。</p>
        <div className="recitation-inputs">{question.answers.map((_, index) => <label key={`${question.id}:${index}`}>第 {index + 1} 空<textarea aria-label={`第 ${index + 1} 空`} value={responses[index] ?? ''} readOnly={revealed} maxLength={2000} spellCheck={false} rows={2} placeholder="先回忆，或在这里默写…" onChange={event => setResponses(old => question.answers.map((_, i) => i === index ? event.target.value : old[i] ?? ''))} /></label>)}</div>
        {revealed && <div className="recitation-answer" aria-label="默写答案"><span className="eyebrow">参考答案</span><Answers question={question} />
          <div className="recitation-check" aria-label="默写核对">{question.answers.map((_, index) => {
            const result = checkRecitationAnswer(responses[index] ?? '', question, index);
            return <div key={index} className={`check-row ${result.status}`}><strong>第 {index + 1} 空 · {result.status === 'correct' ? '字句正确' : result.status === 'incorrect' ? '有错漏字' : '未输入，可按口头回忆自评'}</strong>{result.status === 'incorrect' && <p>{result.parts.map((part, i) => part.kind === 'equal' ? <span key={i}>{part.actual}</span> : <span key={i}>{part.actual && <del aria-label={`错字或多字 ${part.actual}`}>{part.actual}</del>}{part.expected && <ins aria-label={`应写 ${part.expected}`}>{part.expected}</ins>}</span>)}</p>}</div>;
          })}</div><p className="micro">核对忽略标点和空格；错字、多字、漏字仍会标出。请结合实际回忆情况自评。</p>
        </div>}
        {revealed && question.articleId && data.articles.some(article => article.id === question.articleId) && <button className="text-button" onClick={() => go(`articles/${question.articleId}`)}><BookOpen size={15} /> 回到课文查阅</button>}
      </section>{revealed ? <div className="rating-area"><p>这一次，原句记得怎么样？</p><div className="rating-grid">{ratings.map(rating => <button key={rating.grade} className={`rating-button ${rating.className}`} disabled={busy} onClick={() => void grade(rating.grade)}><kbd>{rating.grade}</kbd><strong>{rating.title}</strong><span>{session.mode === 'scheduled' && preview[rating.grade] ? intervalLabel(preview[rating.grade], now) : '记录本次表现'}</span></button>)}</div></div> : <div className="reveal-area"><button className="button primary reveal-button" onClick={() => setRevealed(true)}>查看答案并核对 <ArrowRight size={18} /></button><span className="micro">只有完成自评，才会记录本次回忆。</span></div>}</>
        : <Empty title="这道题已发生变化" description="返回默写题库，重新开始一轮。"><button className="button" onClick={() => setSession(null)}>返回默写题库</button></Empty>}
  </div>;

  return <><Heading eyebrow="RECALL THE ORIGINAL" title="理解性默写" subtitle="由题意，回到原文。先试着背出，再落笔核对。" />
    <section className="stats-grid" aria-label="默写学习概况">{[
      ['题库收录', state.questions.length, '道题'], ['到期待复习', stats.due, '道题'], ['计划内待学', stats.fresh, '道题'], ['今日已复习', stats.done, '次'],
    ].map(([label, value, unit]) => <div className="stat-card" key={label}><span className="muted small">{label}</span><div className="stat-number">{value}<small>{unit}</small></div></div>)}</section>
    <div className="recitation-toolbar"><div className="tabs" aria-label="默写模式">{([['bank', '默写题库'], ['practice', '自由抽背'], ['scheduled', '今日复习']] as const).map(([id, name]) => <button key={id} aria-pressed={view === id} className={view === id ? 'selected' : ''} onClick={() => setView(id)}>{name}</button>)}</div><label className="search-field"><Search size={16} /><input aria-label="搜索默写题" value={search} placeholder="搜索题意或篇名…" onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="scope-tags recitation-works" aria-label="默写篇目">{['all', ...works].map(value => <button key={value} className={`scope-chip ${work === value ? 'selected' : ''}`} aria-pressed={work === value} onClick={() => setWork(value)}>{value === 'all' ? '全部篇目' : value}<span>{state.questions.filter(q => value === 'all' || q.work === value).length} 题</span></button>)}</div>
    <section className="paper-card recitation-settings"><div><h2>{view === 'bank' ? '每一种题意，都认真记住。' : view === 'practice' ? '选好范围，开始一轮回忆。' : '按记忆安排，再见这些原句。'}</h2><p className="muted small">{view === 'scheduled' ? `当前范围可复习 ${queue.length} 道；先复习到期题，再学习新题。${stats.later ? `今天稍后还有 ${stats.later} 道。` : ''}` : `当前筛选 ${matched.length} 道题。自由抽背单独记录，正式计划按 FSRS 安排。`}</p></div>
      <div className="recitation-options"><label>题目范围<select aria-label="默写题目范围" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部题目</option><option value="planned">已加入计划</option><option value="difficult">曾经忘记</option></select></label>
        {view === 'practice' && <><label>本轮题量<select aria-label="默写题量" value={limit} onChange={event => setLimit(Number(event.target.value))}>{[5, 10, 20, 50, 100].map(value => <option key={value} value={value}>{value === 100 ? '全部' : `${value} 题`}</option>)}</select></label><label>出题顺序<select aria-label="默写出题顺序" value={random ? 'random' : 'ordered'} onChange={event => setRandom(event.target.value === 'random')}><option value="random">随机抽背</option><option value="ordered">按题号顺序</option></select></label></>}
        {view === 'scheduled' && <label>每日新题上限<select aria-label="每日默写新题上限" value={state.dailyNew} onChange={event => { const dailyNew = Number(event.target.value); void update(current => ({ ...current, recitation: { ...recitationState(current), dailyNew } })); }}>{[...new Set([0, 5, 10, 20, 30, 50, 100, state.dailyNew])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} 道</option>)}</select></label>}
      </div><div className="button-row"><button className="button" disabled={busy || !matched.some(question => !state.cards[question.id])} onClick={() => void plan(matched.map(question => question.id))}><ListPlus size={16} /> 将筛选结果加入计划</button>{view !== 'bank' && <button className="button primary" disabled={view === 'scheduled' ? !queue.length : !matched.length} onClick={() => start(view === 'scheduled' ? 'scheduled' : 'practice')}>{view === 'scheduled' ? <Clock3 size={16} /> : <Shuffle size={16} />}{view === 'scheduled' ? '开始默写复习' : '开始默写抽背'}<ArrowRight size={16} /></button>}</div>
      {view === 'scheduled' && !queue.length && <p className="micro">没有到期任务时，可以先将题目加入计划，或切换到自由抽背。每日新题上限只限制默写新题，不限制到期复习。</p>}
    </section>
    {!matched.length && <Empty title="没有匹配的默写题" description="试试其他篇目、关键词或题目范围。" />}
    {view === 'bank' && <div className="recitation-bank">{matched.map(question => <article className="paper-card recitation-card" key={question.id}><div className="spread"><span className="badge">《{question.work}》第 {question.number} 题</span><span className="muted small">{state.cards[question.id] ? state.cards[question.id].state === 0 ? '计划内待学' : intervalLabel(state.cards[question.id].dueAt, now) : '未加入计划'}</span></div><h2>{question.prompt}</h2><details><summary>展开参考答案</summary><Answers question={question} /></details><div className="recitation-card-actions"><button className="text-button" onClick={() => start('practice', question.id)}><NotebookPen size={15} /> 背这道题</button><button className="text-button" disabled={busy || !!state.cards[question.id]} onClick={() => void plan([question.id])}>{state.cards[question.id] ? <Check size={15} /> : <ListPlus size={15} />}{state.cards[question.id] ? '已加入计划' : '加入默写计划'}</button></div></article>)}</div>}
  </>;
}
