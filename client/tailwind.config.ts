import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Page / surface
        surface: '#f1f5f9',   // slate-100: page background
        // Cards / panels
        card: '#ffffff',
        // Border / dividers
        line: {
          DEFAULT: '#e2e8f0', // slate-200
          strong:  '#cbd5e1', // slate-300
        },
        // Text scale
        ink: {
          DEFAULT: '#1e293b', // slate-800
          muted:   '#64748b', // slate-500
          faint:   '#94a3b8', // slate-400
        },
        // Status / accent (kept bright for industrial visibility)
        accent: {
          green:  '#16a34a', // green-600
          yellow: '#d97706', // amber-600
          red:    '#dc2626', // red-600
          blue:   '#2563eb', // blue-600
          orange: '#ea580c', // orange-600
        },
        status: {
          ok:    '#16a34a',
          warn:  '#d97706',
          error: '#dc2626',
          idle:  '#94a3b8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
      },
      animation: {
        blink:        'blink 1s step-start infinite',
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        alarm:        'alarm 0.6s ease-in-out infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        alarm: {
          '0%, 100%': { backgroundColor: '#fef2f2', borderColor: '#dc2626' },
          '50%':      { backgroundColor: '#fee2e2', borderColor: '#b91c1c' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
