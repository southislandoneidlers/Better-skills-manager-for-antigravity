import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './App.tsx';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>,
  );
}
