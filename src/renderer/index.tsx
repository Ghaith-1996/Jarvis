import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Island } from './Island.tsx';

const island = new URLSearchParams(location.search).get('view') === 'island';
document.documentElement.classList.toggle('island-view', island);
createRoot(document.getElementById('root')!).render(island ? <Island /> : <App />);
