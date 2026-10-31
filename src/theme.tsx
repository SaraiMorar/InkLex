import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Preference = 'system' | 'light' | 'dark';
const key = 'inklex.theme';
const preference = (value: string | null): Preference => value === 'dark' || value === 'light' ? value : 'system';
function readPreference(): Preference {
  try { return preference(localStorage.getItem(key)); } catch { return 'system'; }
}

export function ThemeControl() {
  const [mode, setMode] = useState(readPreference);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#151d19' : '#f7f8f4');
      setDark(resolved === 'dark');
    };
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [mode]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setMode(readPreference()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <label className="theme-control">{dark ? <Moon size={15} /> : <Sun size={15} />}<select aria-label="外观模式" value={mode} onChange={e => {
    const next = preference(e.target.value); setMode(next);
    try { localStorage.setItem(key, next); } catch { /* In-session selection still works when storage is unavailable. */ }
  }}><option value="system">跟随系统</option><option value="light">浅色模式</option><option value="dark">暗色模式</option></select></label>;
}
