import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
import './styles/table.css';
import './styles/sheet.css';

const root = document.getElementById('root');
createRoot(root).render(<App />);
// tell the public shell page that the app took over
requestAnimationFrame(() => window.dispatchEvent(new Event('rp20:ready')));
