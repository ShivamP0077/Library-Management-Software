export const APP_URL = import.meta.env.VITE_APP_URL || '/app';
export const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'hello@example.com';
export const DEMO_HREF = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent('Library OS demo request')}&body=${encodeURIComponent('Hi, I run a reading library / study room and would like a demo.\n\nLibrary name:\nCity:\nNumber of seats:\nNumber of branches:\n')}`;
export const BRAND = 'Library OS';
