export const APP_URL = import.meta.env.VITE_APP_URL || '/app';
export const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'mylibraryosadmin@gmail.com';
export const DEMO_HREF = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent('My Library OS demo request')}&body=${encodeURIComponent('Hi, I run a reading library / study room and would like a demo.\n\nLibrary name:\nCity:\nNumber of seats:\nNumber of branches:\n')}`;
export const BRAND = 'My Library OS';
