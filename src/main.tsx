import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Create root element
const container = document.getElementById('app');
if (!container) {
  const newContainer = document.createElement('div');
  newContainer.id = 'app';
  document.body.appendChild(newContainer);
}

// Mount React app
const root = createRoot(container || document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
