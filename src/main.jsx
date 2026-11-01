import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './responsive.css';
import { initResponsiveTables } from './utils/responsiveTables';

initResponsiveTables();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
