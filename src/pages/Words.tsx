import { useState } from 'react';
import { ArrowRight, Check, Edit3, Plus, Search } from 'lucide-react';
import { Empty, go, Heading, MemoryChart, Modal } from '../components';
import { useStore } from '../store';
import { contextsFor, getWord } from '../domain/model';
import { enroll, intervalLabel } from '../domain/scheduler';

export function Words() {
  const { data, now, update, notify } = useStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState<string | null>(null);
  const entries = data.entries.filter(entry => {
    const senses = data.senses.filter(s => s.entryId === entry.id);
    const matches = entry.word.includes(search.trim()) || senses.some(s => s.meaning.includes(search.trim()) || data.contexts.some(c => c.senseId === s.id && (c.text.includes(search.trim()) || c.source.includes(search.trim()))));
    return matches && (filter === 'all' || senses.some(s => filter === 'planned' ? data.cards[s.id] : filter === 'difficult' ? data.reviews.some(r => r.senseId === s.id && r.grade === 1) : data.contexts.some(c => c.senseId === s.id && !c.verified)));
  });
  const entry = data.entries.find(e => e.id === active);
  const add = async (senseId: string) => { if (await update(current => enroll(current, [senseId]))) notify('已加入学习计划。'); };
  return <><Heading eyebrow="WORDS WITH A STORY" title="一字多义，各有来处。" subtitle="把散落在课文里的字，汇成自己的文言字词库。" action={<button className="button primary" onClick={() => go('manage?new=context')}><Plus size={16} /> 添加字词</button>} />
    <div className="toolbar"><div className="tabs">{[['all', '全部字词'], ['planned', '计划内'], ['difficult', '曾忘记'], ['pending', '待核对']].map(([id, name]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{name}</button>)}</div><label className="search-field"><Search size={17} /><input aria-label="搜索字词或释义" placeholder="搜索字词、释义或例句…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    <div className="shelf-label"><span>{entries.length} 个字词</span><span>按义项学习，让一词多义清清楚楚</span></div><div className="word-grid">{entries.map(entry => {
      const senses = data.senses.filter(s => s.entryId === entry.id);
      const contexts = data.contexts.filter(c => senses.some(s => s.id === c.senseId));
      const sources = [...new Set(contexts.map(c => c.source).filter(Boolean))];
      return <button className="word-card" key={entry.id} onClick={() => setActive(entry.id)}><div className="spread"><span className="word-display">{entry.word}</span><span className="badge">{senses.length} 个义项</span></div><div className="meaning-list">{senses.slice(0, 2).map((s, i) => <p key={s.id}><small>{String(i + 1).padStart(2, '0')}</small>{s.meaning}</p>)}</div><div className="word-card-footer"><span>{sources.slice(0, 2).join(' · ') || '自录例句'}</span><ArrowRight size={15} /></div></button>;
    })}</div>{!entries.length && <Empty title="还没找到这个字词" description="可以换一个关键词，或把新的例句收入字词库。" />}
    {entry && <Modal title={`「${entry.word}」的字里行间`} onClose={() => setActive(null)} wide><div className="word-detail-intro"><span className="word-display">{entry.word}</span><p>同一个字，沿着不同语境展开。<br /><span className="muted">每个义项分别记录学习进度。</span></p></div>{data.senses.filter(s => s.entryId === entry.id).map((s, i) => {
      const card = data.cards[s.id];
      const contexts = data.contexts.filter(c => c.senseId === s.id);
      return <section className="sense-section" key={s.id}><div className="spread"><h3><span className="sense-number">{String(i + 1).padStart(2, '0')}</span>{s.meaning}</h3><button className="button small-button" disabled={!!card || !contextsFor(data, s.id).length} onClick={() => void add(s.id)}>{card ? <Check size={14} /> : <Plus size={14} />}{card ? '已在计划' : '加入计划'}</button></div>{s.note && <p className="sense-note">{s.note}</p>}{contexts.map(c => <div className="context-example" key={c.id}><div className="spread"><span className="source-label">{c.source || '自录例句'}{!c.verified && <span className="badge warm">待核对</span>}</span><button className="text-button" onClick={() => go(c.articleId ? `articles/${c.articleId}?context=${c.id}` : `manage?context=${c.id}`)}><Edit3 size={13} /> 编辑</button></div><p className="example-prose">{c.text.slice(0, c.start)}<mark>{getWord(data, c.senseId)}</mark>{c.text.slice(c.start + entry.word.length)}</p><p className="small muted">本处释义：{c.gloss}</p>{c.articleId && <button className="text-button" onClick={() => go(`articles/${c.articleId}`)}>回到完整原文 <ArrowRight size={13} /></button>}</div>)}{card && <div className="sense-status"><span>{card.state === 0 ? '待首次学习' : `已回忆 ${card.reps} 次 · ${intervalLabel(card.dueAt, now)}`}</span><span>{card.lastReviewAt ? `上次：${new Date(card.lastReviewAt).toLocaleString('zh-CN')}` : '从一次主动回忆开始'}</span></div>}{card?.lastReviewAt && <details className="curve-details"><summary>查看此义项的记忆曲线</summary><MemoryChart senseId={s.id} /></details>}</section>;
    })}</Modal>}
  </>;
}
