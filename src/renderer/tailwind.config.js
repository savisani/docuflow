import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    resolve(__dirname, './index.html'),
    resolve(__dirname, './src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        df: {
          bg: '#08080f',
          'surface-1': '#0c0c16',
          'surface-2': '#12121e',
          'surface-3': '#181828',
          'surface-4': '#1e1e30',
          border: 'rgba(139, 92, 246, 0.10)',
          'border-strong': 'rgba(139, 92, 246, 0.18)',
          'border-focus': 'rgba(224, 64, 160, 0.5)',
          divider: 'rgba(139, 92, 246, 0.08)',
          // Text
          'text-primary': '#f0f0f5',
          'text-secondary': '#9898b0',
          'text-muted': '#5c5c78',
          'text-dim': '#3a3a50',
          // Accent — magenta/pink primary
          accent: '#e040a0',
          'accent-hover': '#ec60b8',
          'accent-active': '#c83090',
          'accent-muted': 'rgba(224, 64, 160, 0.12)',
          // Violet secondary
          violet: '#a855f7',
          'violet-muted': 'rgba(168, 85, 247, 0.10)',
          // Status
          success: '#3ecf8e',
          'success-muted': 'rgba(62, 207, 142, 0.12)',
          warning: '#f5a623',
          'warning-muted': 'rgba(245, 166, 35, 0.12)',
          error: '#ef5350',
          'error-muted': 'rgba(239, 83, 80, 0.12)',
          // Tracks
          'track-video': '#a855f7',
          'track-text': '#e040a0',
          'track-sfx': '#f5a623',
          'track-music': '#3ecf8e',
          'track-ambient': '#5cc9d4',
          'track-voiceover': '#c084fc',
        },
      },
      fontFamily: {
        ui: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        'df-xs': ['10px', { lineHeight: '14px' }],
        'df-sm': ['11px', { lineHeight: '16px' }],
        'df-base': ['12px', { lineHeight: '18px' }],
        'df-md': ['13px', { lineHeight: '20px' }],
        'df-lg': ['14px', { lineHeight: '22px' }],
        'df-xl': ['16px', { lineHeight: '24px' }],
      },
      spacing: {
        'df-0': '0',
        'df-1': '2px',
        'df-2': '4px',
        'df-3': '6px',
        'df-4': '8px',
        'df-5': '10px',
        'df-6': '12px',
        'df-8': '16px',
        'df-10': '20px',
        'df-12': '24px',
        'df-16': '32px',
      },
      borderRadius: {
        'df-none': '0',
        'df-xs': '2px',
        'df-sm': '3px',
        'df-md': '4px',
        'df-lg': '6px',
        'df-xl': '8px',
      },
      transitionDuration: {
        'df-fast': '100ms',
        'df-normal': '160ms',
        'df-slow': '240ms',
      },
      transitionTimingFunction: {
        'df-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'df-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
      boxShadow: {
        'df-subtle': '0 1px 2px rgba(0,0,0,0.4)',
        'df-medium': '0 4px 12px rgba(0,0,0,0.5)',
        'df-heavy': '0 8px 24px rgba(0,0,0,0.6)',
        'df-focus': '0 0 0 2px rgba(224, 64, 160, 0.4)',
        'df-glow': '0 0 20px rgba(168, 85, 247, 0.15)',
      },
    },
  },
  plugins: [],
}
