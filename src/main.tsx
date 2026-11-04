import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';
import './styles.css';
import './dark.css';
import './recitation.css';

createRoot(document.getElementById('root')!).render(<StrictMode><StoreProvider><App /></StoreProvider></StrictMode>);
