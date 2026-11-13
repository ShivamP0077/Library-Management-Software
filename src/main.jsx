import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PublicEnquiryForm } from './components/enquiry/PublicEnquiryForm';
import './index.css';
import './responsive.css';
import { initResponsiveTables } from './utils/responsiveTables';
import { applyTheme, readTheme } from './utils/theme';

applyTheme(readTheme());
initResponsiveTables();

function publicEnquiryToken() {
  const match = window.location.pathname.match(/^\/enquiry\/([^/]+)\/?$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

const enquiryToken = publicEnquiryToken();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {enquiryToken ? <PublicEnquiryForm token={enquiryToken} /> : <App />}
  </React.StrictMode>
);
