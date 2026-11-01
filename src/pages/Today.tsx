import { ArrowRight, BookOpen, Check, Clock3, Flame, Plus, Sparkles, Sprout } from 'lucide-react';
import { ArticleCard, Empty, go, Heading, MemoryChart } from '../components';
import { useStore } from '../store';
import { dailyStats, eligibleSenseIds, intervalLabel, localDay, studyQueue } from '../domain/scheduler';
import { articleCollection, getWord } from '../domain/model';

export function Today() {
  const { data, now } = useStore();
  const stats = dailyStats(data, now);
  const queue = studyQueue(data, now);
  const latest = [...data.reviews].reverse().find(r => r.mode === 'scheduled');
  const eligible = eligibleSenseIds(data);
  const upcoming = Object.entries(data.cards).filter(([id, c]) => c.state !== 0 && eligible.has(id)).sort(([, a], [, b]) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).slice(0, 4);
  const studyToday = new Date(now);
  studyToday.setHours(studyToday.getHours() - 3);
  const days = Array.from({ length: 7 }, (_, i) => { const day = new Date(studyToday); day.setDate(day.getDate() - 6 + i); day.setHours(12); return day; });
  const activeDays = new Set(data.reviews.filter(r => r.mode === 'scheduled').map(r => localDay(new Date(r.time))));
  return <>
    <Heading eyebrow="A LITTLE EVERY DAY" title="温故，而知新。" subtitle="在原文中理解，在复习中记住。今天，也让一点知识留下来。" action={<button className="button" onClick={() => go('manage')}><Plus size={16} /> 添加学习资料</button>} />
    <section className="stats-grid" aria-label="学习概况">{[
      { label: '到期待复习', value: stats.due, unit: '个义项', icon: Clock3, color: 'clay', detail: '让记忆再次清晰' },
      { label: '计划内待学', value: stats.fresh, unit: '个义项', icon: Sprout, color: 'green', detail: `每日新增上限 ${data.settings.dailyNew} 个` },
      { label: '今日已复习', value: stats.done, unit: '次', icon: Check, color: 'blue', detail: stats.later ? `今天稍后还有 ${stats.later} 项` : '每一次回忆都有意义' },
      { label: '字词收藏', value: data.entries.length, unit: '个字词', icon: BookOpen, color: 'gold', detail: `${data.senses.length} 个义项 · ${data.articles.length} 篇课文` },
    ].map(({ label, value, unit, icon: Icon, color, detail }) => <div className="stat-card" key={label}><div className="spread"><span>{label}</span><span className={`stat-icon ${color}`}><Icon size={18} strokeWidth={1.7} /></span></div><div className="stat-number">{value}<small>{unit}</small></div><p>{detail}</p></div>)}</section>
    <div className="today-columns"><div className="today-main">
      <section className="study-banner"><div className="banner-copy"><span className="light-eyebrow"><Sparkles size={14} /> 今日的温习时刻</span><h2>{queue.length ? '重逢旧知，遇见新意。' : stats.later ? '让记忆沉淀一会儿。' : '从一篇课文，开始积累。'}</h2><p>{queue.length ? `已有 ${queue.length} 个义项等待回忆。按自己的节奏，开始今天的学习。` : stats.later ? `今天稍后还有 ${stats.later} 个义项需要再见一面，也可以先读一篇文章。` : '点开原文里的一个字，读懂一句话，再把它留在记忆里。'}</p><button className="button cream" onClick={() => go(queue.length ? 'review' : 'articles')}>{queue.length ? '开始今日复习' : '去课文书架'}<ArrowRight size={17} /></button></div><div className="banner-seal" aria-hidden="true"><div className="seal-ring" /><span>温<br />故</span><small>日有所学<br />常有所忆</small></div></section>
      <div className="section-heading"><div><h2>翻开一篇，读懂一字</h2><p>在完整的语境里，重新遇见熟悉的文字。</p></div><button className="text-button" onClick={() => go('articles')}>全部课文 <ArrowRight size={15} /></button></div>
      <div className="article-grid dashboard-articles">{[...data.articles].sort((a, b) => Number(articleCollection(a) === 'extracurricular') - Number(articleCollection(b) === 'extracurricular')).slice(0, 2).map((a, i) => <ArticleCard key={a.id} article={a} index={i} />)}{!data.articles.length && <Empty title="书架等你添上第一篇" description="添加原文并标记重点字词，就能开始学习。"><button className="button" onClick={() => go('manage')}>添加课文</button></Empty>}</div>
      <section className="paper-card upcoming"><div className="section-heading compact"><h2>接下来，再见</h2><span className="muted small">随记忆表现动态安排</span></div>{upcoming.length ? upcoming.map(([id, card]) => <div className="upcoming-row" key={id}><span className="word-mini">{getWord(data, id)}</span><div><strong>{data.senses.find(s => s.id === id)?.meaning}</strong><small>{card.reps} 次正式回忆</small></div><span className={new Date(card.dueAt) <= now ? 'badge warm' : 'badge'}>{intervalLabel(card.dueAt, now)}</span></div>) : <p className="muted empty-inline">完成第一次抽背后，下一次复习会自动安排在这里。</p>}</section>
    </div><aside className="today-aside">
      <section className="paper-card rhythm-card"><div className="spread"><h2>把学习变成日常</h2><Flame size={18} className="clay-text" /></div><p className="muted small">最近七天 · 每一次回忆都算数</p><div className="week-strip">{days.map(day => <div key={localDay(day)} className={localDay(day) === localDay(now) ? 'is-today' : ''}><span>{['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</span><b className={activeDays.has(localDay(day)) ? 'done' : ''}>{activeDays.has(localDay(day)) ? <Check size={15} /> : day.getDate()}</b></div>)}</div><div className="rhythm-bottom"><span>本周有学习记录</span><strong>{days.filter(d => activeDays.has(localDay(d))).length}<small> / 7 天</small></strong></div></section>
      <section className="paper-card curve-card"><div className="spread"><h2>记忆，循序渐进</h2><span className="badge">FSRS</span></div><p className="muted small">掌握得越稳，再见的间隔越长。</p><MemoryChart senseId={latest?.senseId} /><div className="target-row"><span>目标保持率</span><strong>{Math.round(data.settings.retention * 100)}%</strong><button className="text-button" onClick={() => go('manage')}>调整</button></div></section>
      <div className="reading-tip"><span className="eyebrow">学习小笺</span><p>看到释义前，<br />先给自己一点回忆的时间。</p><span>主动想起来，比再读一遍更有帮助。</span></div>
    </aside></div>
  </>;
}
