import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, X } from 'lucide-react';
import { useStore } from './store';
import { getWord, type Article } from './domain/model';
import { memoryCurve } from './domain/scheduler';

export const go = (path: string) => { window.location.hash = `/${path}`; window.scrollTo(0, 0); };
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const fn = () => setHash(location.hash); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
  const url = new URL(hash.slice(1) || '/today', 'https://inklex.local');
  return { path: url.pathname.slice(1), params: url.searchParams };
}
export function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}
export function Empty({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><BookOpen size={30} strokeWidth={1.3} /><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = old; }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="modal-inner"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>{children}</div></dialog>;
}
export function Landscape({ variant = 0 }: { variant?: number }) {
  return <svg className={`landscape landscape-${variant % 3}`} viewBox="0 0 500 180" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <circle cx={variant % 2 ? '390' : '360'} cy="42" r="22" className="sun" />
    <path d="M-10 148Q40 109 72 116Q120 50 161 85Q200 106 242 61Q274 20 310 77Q350 111 400 72Q446 45 520 122V190H-10Z" className="mountain far" />
    <path d="M-10 180Q66 107 135 140Q200 170 263 110Q340 57 404 123Q456 160 520 110V190H-10Z" className="mountain near" />
    <path d="M132 182Q222 143 279 156T449 160" fill="none" stroke="currentColor" strokeOpacity=".18" />
    <path d="M80 76l7-3 7 3M106 63l6-3 6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity=".35" />
  </svg>;
}
export function ArticleCard({ article, index = 0 }: { article: Article; index?: number }) {
  const { data } = useStore();
  const contexts = data.contexts.filter(c => c.articleId === article.id && c.verified);
  const ids = [...new Set(contexts.map(c => c.senseId))];
  const learned = ids.filter(id => data.cards[id]?.state > 0).length;
  return <button className="article-card" onClick={() => go(`articles/${article.id}`)}>
    <div className="article-art"><Landscape variant={index} /><span className="art-caption">{article.era || '选文'} · {article.author || '作者待补'}</span><span className="vertical-title" aria-hidden="true">{article.title}</span>{article.sample && <span className="sample-tag">示例</span>}</div>
    <div className="article-card-body"><div className="spread"><h3>{article.title}</h3><ArrowUpRight size={19} /></div><p>{article.summary || article.body.slice(0, 28)}</p><div className="article-card-footer"><span>{ids.length} 个重点义项</span><span>{learned ? `已学 ${learned} / ${ids.length}` : '待你翻阅'}</span></div><div className="progress-line"><i style={{ width: `${ids.length ? learned / ids.length * 100 : 0}%` }} /></div></div>
  </button>;
}
export function MemoryChart({ senseId }: { senseId?: string }) {
  const { data } = useStore();
  const [points, setPoints] = useState<{ day: number; probability: number }[]>([]);
  const [error, setError] = useState(false);
  const card = senseId ? data.cards[senseId] : undefined;
  useEffect(() => {
    let live = true; setError(false);
    if (!senseId) { setPoints([]); return; }
    memoryCurve(data, senseId).then(p => { if (live) setPoints(p); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [senseId, card, data.settings.retention]);
  if (!points.length || error) return <div className="curve-empty"><div className="curve-empty-line" /><p>{error ? '暂时无法计算记忆估计' : '完成第一次抽背后'}<br /><strong>{error ? '复习记录仍然保留' : '在这里看见你的记忆变化'}</strong></p></div>;
  const maxDay = points.at(-1)!.day;
  const toX = (d: number) => 34 + d / maxDay * 284;
  const toY = (p: number) => 24 + (1 - p) * 165;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${toX(p.day)},${toY(p.probability)}`).join(' ');
  const targetY = toY(data.settings.retention);
  return <div className="memory-chart"><div className="spread"><span>「{getWord(data, senseId!)}」的回忆概率</span><span className="muted">算法估计</span></div><svg viewBox="0 0 344 215" role="img" aria-label="根据当前义项 FSRS 记忆状态计算的估计曲线">
    {[1, .8, .6, .4].map(p => <g key={p}><line x1="34" x2="318" y1={toY(p)} y2={toY(p)} stroke="currentColor" opacity=".09" /><text x="0" y={toY(p) + 4}>{Math.round(p * 100)}%</text></g>)}
    <path d={`${path} L318,189 L34,189 Z`} fill="var(--sage)" opacity=".4" /><path d={path} fill="none" stroke="var(--green)" strokeWidth="2.5" />
    <line x1="34" x2="318" y1={targetY} y2={targetY} stroke="var(--clay)" strokeDasharray="4 4" opacity=".7" />
    {points.filter((_, i) => i % 5 === 0).map(p => <circle key={p.day} cx={toX(p.day)} cy={toY(p.probability)} r="4" fill="var(--green)"><title>复习后 {p.day.toFixed(1)} 天：约 {(p.probability * 100).toFixed(0)}%</title></circle>)}
    <text x="34" y="209">上次复习</text><text x="275" y="209">{maxDay.toFixed(0)} 天后</text>
  </svg><p className="micro">虚线为目标保持率；曲线由该义项的实际复习状态估算。</p></div>;
}
