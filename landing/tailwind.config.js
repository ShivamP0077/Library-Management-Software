/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1C1917', 950: '#0C0A09', 900: '#141210', 800: '#1C1917', 700: '#292524', 600: '#44403C' },
        paper: '#FAFAF9',
        gold: { DEFAULT: '#A16207', 300: '#F5D489', 400: '#E8B54A', 500: '#CA8A04', 600: '#A16207', 700: '#854D0E' },
      },
      fontFamily: {
        display: ['Satoshi', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"General Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(232,181,74,.25), 0 20px 60px -20px rgba(202,138,4,.45)',
        card: '0 1px 2px rgba(0,0,0,.05), 0 10px 30px -12px rgba(28,25,23,.18)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
      },
      animation: { shimmer: 'shimmer 6s linear infinite' },
    },
  },
  plugins: [],
};
