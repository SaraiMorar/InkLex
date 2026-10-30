import { BookOpen, CalendarDays, Database, Feather, Layers3, Leaf, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { go, useRoute } from './components';
import { useStore } from './store';
import { Today } from './pages/Today';
import { Articles, Reader } from './pages/Articles';
import { Words } from './pages/Words';
import { ReviewPage } from './pages/Review';
import { Manage } from './pages/Manage';
import { dailyStats } from './domain/scheduler';

const nav = [
  { id: 'today', name: '今日学习', en: 'TODAY', icon: CalendarDays },
  { id: 'articles', name: '课文书架', en: 'READING', icon: BookOpen },
  { id: 'words', name: '我的字词库', en: 'LEXICON', icon: Layers3 },
  { id: 'review', name: '抽背与复习', en: 'RECALL', icon: Sparkles },
  { id: 'manage', name: '资料与设置', en: 'COLLECTION', icon: Database },
];
export function App() {
  const { path, params } = useRoute();
  const { data, now, storageError, saving } = useStore();
  const section = path.split('/')[0] || 'today';
  const article = section === 'articles' && path.includes('/') ? path.split('/')[1] : undefined;
  const stats = dailyStats(data, now);
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => go('today')} aria-label="InkLex 首页"><span className="brand-mark"><BookOpen size={25} strokeWidth={1.4} /></span><span><strong>InkLex<span className="brand-dot">.</span></strong><small>字里行间 · 温故知新</small></span></button>
      <div className="nav-caption">我的书斋</div><nav aria-label="主导航">{nav.map(({ id, name, en, icon: Icon }) => <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={19} strokeWidth={1.6} /><span>{name}<small>{en}</small></span>{id === 'review' && stats.due > 0 && <b className="nav-badge">{stats.due}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-quote"><Leaf size={22} strokeWidth={1.3} /><p>学而时习之，<br />不亦说乎。</p><span>《论语》</span></div><div className="local-profile"><div className="avatar">习</div><span>我的学习空间<small>日积月累，自有所得</small></span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><Feather size={16} /><span>我的书斋</span><i>/</i><strong>{nav.find(n => n.id === section)?.name || '今日学习'}</strong></div><div className="topbar-right"><span className="saved"><i className={storageError ? 'error-dot' : ''} />{storageError ? '连接异常' : saving ? '正在保存' : '已保存到服务'}</span><button className="icon-button" aria-label="搜索字词" onClick={() => go('words')}><Search size={18} /></button><span className="topbar-date">{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span></div></header>
      <main className="main-content" key={path + params.toString()}>
        {section === 'today' && <Today />}
        {section === 'articles' && (article ? <Reader articleId={article} /> : <Articles />)}
        {section === 'words' && <Words />}
        {section === 'review' && <ReviewPage initialArticle={params.get('article')} />}
        {section === 'manage' && <Manage params={params} />}
        {!nav.some(n => n.id === section) && <Today />}
      </main><footer className="page-footer"><span>InkLex · 让每一次温习，都留下痕迹。</span><span><ShieldCheck size={13} /> 资料自动保存到服务，浏览器间共享进度</span></footer>
    </div>
  </div>;
}
