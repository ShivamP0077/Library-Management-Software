import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App.jsx';

try {
  // Mock localStorage
  global.localStorage = {
    getItem: (key) => null,
    setItem: (key, value) => {},
    removeItem: (key) => {}
  };
  global.window = { matchMedia: () => ({ matches: false }) };
  
  const html = renderToString(React.createElement(App));
  console.log("Successfully rendered App:", html.substring(0, 50) + "...");
} catch (error) {
  console.error("SSR RENDER ERROR:", error);
}
