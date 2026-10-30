import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { type Database, emptyDatabase } from './domain/model';
import { exportText, STORAGE_KEY } from './domain/storage';
import { ApiError, migrateLegacy, readServer, transact, type Snapshot } from './domain/api';

export function downloadFile(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Store = {
  data: Database; now: Date; storageError: string | null; toast: string; saving: boolean;
  update: (operation: (data: Database) => Database | Promise<Database>) => Promise<boolean>;
  notify: (message: string) => void;
};
const StoreContext = createContext<Store | null>(null);
export const useStore = () => useContext(StoreContext)!;
export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(emptyDatabase);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = useRef<Snapshot | null>(null);
  const pending = useRef(0);
  const chain = useRef(Promise.resolve());
  const notify = useCallback((message: string) => setToast(message), []);
  const apply = useCallback((snapshot: Snapshot) => {
    if (!latest.current || snapshot.serverId !== latest.current.serverId || snapshot.revision >= latest.current.revision) {
      latest.current = snapshot; setData(snapshot.data); setStorageError(snapshot.warning ?? null);
    }
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    let live = true;
    const boot = async () => {
      try {
        let snapshot = await readServer();
        try { snapshot = await migrateLegacy(snapshot); }
        catch (error) { if (live) setMigrationError(`旧版浏览器资料尚未迁移：${error instanceof Error ? error.message : '请重试'}`); }
        if (live) { apply(snapshot); setReady(true); }
      } catch (error) { if (live) setLoadError(error instanceof Error ? error.message : '无法读取学习资料。'); }
    };
    void boot();
    return () => { live = false; };
  }, [apply]);
  const refresh = useCallback(async () => {
    setNow(new Date());
    if (pending.current || !latest.current) return;
    try { apply(await readServer()); }
    catch (error) { setStorageError(error instanceof Error ? error.message : '连接暂时不可用。'); }
  }, [apply]);
  useEffect(() => {
    const timer = setInterval(() => { setNow(new Date()); if (document.visibilityState === 'visible') void refresh(); }, 10000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const update = useCallback((operation: (data: Database) => Database | Promise<Database>) => {
    let result = false;
    pending.current++; setSaving(true);
    const job = chain.current.then(async () => {
      try {
        const snapshot = await transact(operation);
        apply(snapshot); setNow(new Date()); result = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : '操作未完成，请重试。';
        if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) setStorageError('此次保存尚未确认，操作仍可重试。' + message);
        notify(message);
      } finally { pending.current--; if (!pending.current) setSaving(false); }
    });
    chain.current = job.catch(() => {});
    return job.then(() => result);
  }, [apply, notify]);

  if (!ready) return <div className="recovery"><div className="paper-card"><span className="eyebrow">INKLEX · 温故知新</span><h1>{loadError ? '学习服务尚未连接' : '正在打开你的字词库…'}</h1>{loadError ? <><p role="alert">{loadError}</p><p>在项目文件夹中运行 npm run dev，或先构建后运行 npm start，再重新连接。</p><button className="button primary" onClick={() => location.reload()}>重新连接</button></> : <p>正在从服务读取资料和复习进度。</p>}</div></div>;
  return <StoreContext.Provider value={{ data, now, update, storageError, toast, saving, notify }}>
    {children}
    {migrationError && <div className="migration-notice" role="alert">{migrationError}<div className="button-row"><button className="button small-button" onClick={() => { try { downloadFile(localStorage.getItem(STORAGE_KEY) ?? '', 'inklex-legacy-recovery.json'); } catch { notify('浏览器拒绝读取旧数据，请检查站点存储权限。'); } }}>下载旧版原始数据</button><button className="button small-button" onClick={() => setMigrationError(null)}>稍后处理</button></div></div>}
    {storageError && <div className="storage-warning" role="alert">{storageError}<button onClick={() => void refresh()}>重新连接</button><button onClick={() => downloadFile(exportText(data), 'inklex-recovery-backup.json')}>导出已读取资料</button></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </StoreContext.Provider>;
}
