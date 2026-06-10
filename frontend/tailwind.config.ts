/**
 * ITSM — Tailwind 설정
 *
 * 색상 시스템: globals.css CSS 변수 기반 (primary source).
 * 브랜드 컬러: #F5C000 (Hivework Honey — GW와 동일 팔레트 공유)
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      /* =====================
         Colors — CSS 변수 연결
      ===================== */
      colors: {
        /* Brand — ITSM 고유 (#F5C000) */
        brand: {
          DEFAULT: '#F5C000',
          hover:   '#F5B800',
          active:  '#E89412',
          subtle:  'rgba(245, 192, 0, 0.10)',
        },

        /* Primary accent */
        accent: {
          50:  'var(--color-accent-50)',
          100: 'var(--color-accent-100)',
          200: 'var(--color-accent-200)',
          300: 'var(--color-accent-300)',
          400: 'var(--color-accent-400)',
          500: 'var(--color-accent-500)',
          600: 'var(--color-accent-600)',
          700: 'var(--color-accent-700)',
          800: 'var(--color-accent-800)',
          900: 'var(--color-accent-900)',
          950: 'var(--color-accent-950)',
          DEFAULT: 'var(--color-accent-600)',
        },

        /* Neutral */
        neutral: {
          50:  'var(--color-neutral-50)',
          100: 'var(--color-neutral-100)',
          200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)',
          400: 'var(--color-neutral-400)',
          500: 'var(--color-neutral-500)',
          600: 'var(--color-neutral-600)',
          700: 'var(--color-neutral-700)',
          800: 'var(--color-neutral-800)',
          900: 'var(--color-neutral-900)',
          950: 'var(--color-neutral-950)',
        },

        /* Surface */
        bg:                   'var(--color-bg)',
        surface:              'var(--color-surface)',
        'surface-elevated':   'var(--color-surface-elevated)',
        'surface-overlay':    'var(--color-surface-overlay)',
        'surface-hover':      'var(--color-surface-hover)',

        /* Border */
        'border-subtle':      'var(--color-border-subtle)',
        'border-default':     'var(--color-border-default)',
        'border-strong':      'var(--color-border-strong)',

        /* Text */
        'text-primary':       'var(--color-text-primary)',
        'text-secondary':     'var(--color-text-secondary)',
        'text-disabled':      'var(--color-text-disabled)',
        'text-inverse':       'var(--color-text-inverse)',
        'text-accent':        'var(--color-text-accent)',
        'accent-on':          'var(--color-accent-on)',

        /* Semantic */
        success: {
          DEFAULT: 'var(--color-success)',
          bg:      'var(--color-success-bg)',
          border:  'var(--color-success-border)',
          text:    'var(--color-success-text)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          bg:      'var(--color-warning-bg)',
          border:  'var(--color-warning-border)',
          text:    'var(--color-warning-text)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          bg:      'var(--color-error-bg)',
          border:  'var(--color-error-border)',
          text:    'var(--color-error-text)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          bg:      'var(--color-info-bg)',
          border:  'var(--color-info-border)',
          text:    'var(--color-info-text)',
        },

        /* 티켓 우선순위 */
        priority: {
          urgent: 'var(--color-priority-urgent)',
          high:   'var(--color-priority-high)',
          medium: 'var(--color-priority-medium)',
          low:    'var(--color-priority-low)',
        },

        /* 티켓 상태 */
        status: {
          open:        'var(--color-status-open)',
          'open-bg':   'var(--color-status-open-bg)',
          pending:     'var(--color-status-pending)',
          'pending-bg': 'var(--color-status-pending-bg)',
          resolved:    'var(--color-status-resolved)',
          'resolved-bg': 'var(--color-status-resolved-bg)',
          closed:      'var(--color-status-closed)',
          'closed-bg': 'var(--color-status-closed-bg)',
        },
      },

      /* =====================
         Font Family
      ===================== */
      fontFamily: {
        sans: [
          'var(--font-pretendard)',
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'monospace',
        ],
      },

      /* =====================
         Font Size — 9단계 스케일
      ===================== */
      fontSize: {
        xs:    ['12px', { lineHeight: '16px' }],
        sm:    ['14px', { lineHeight: '20px' }],
        base:  ['15px', { lineHeight: '22px' }],
        md:    ['16px', { lineHeight: '24px', fontWeight: '500' }],
        lg:    ['18px', { lineHeight: '28px', fontWeight: '500' }],
        xl:    ['20px', { lineHeight: '30px', fontWeight: '600' }],
        '2xl': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        '3xl': ['30px', { lineHeight: '38px', fontWeight: '700' }],
      },

      /* =====================
         Border Radius
      ===================== */
      borderRadius: {
        none:    '0px',
        sm:      'var(--radius-sm)',
        md:      'var(--radius-md)',
        lg:      'var(--radius-lg)',
        xl:      'var(--radius-xl)',
        full:    'var(--radius-full)',
        DEFAULT: 'var(--radius-md)',
      },

      /* =====================
         Box Shadow
      ===================== */
      boxShadow: {
        none:  'none',
        sm:    'var(--shadow-sm)',
        md:    'var(--shadow-md)',
        lg:    'var(--shadow-lg)',
        xl:    'var(--shadow-xl)',
        brand: 'var(--shadow-brand)',
      },

      /* =====================
         Transition Duration
      ===================== */
      transitionDuration: {
        micro: '100ms',
        fast:  '150ms',
        base:  '200ms',
        slow:  '300ms',
      },

      /* =====================
         Transition Timing
      ===================== */
      transitionTimingFunction: {
        'ease-out':    'cubic-bezier(0, 0, 0.3, 1)',
        'ease-in':     'cubic-bezier(0.7, 0, 1, 1)',
        'ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ease-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      /* =====================
         Keyframes + Animation
      ===================== */
      keyframes: {
        'page-enter': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)',    opacity: '1' },
          to:   { transform: 'translateX(100%)', opacity: '0' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-scale-in': {
          from: { opacity: '0', transform: 'scale(0.97) translateY(4px)' },
          to:   { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
      },
      animation: {
        'page-enter':      'page-enter 150ms cubic-bezier(0, 0, 0.3, 1)',
        'fade-in':         'fade-in 150ms cubic-bezier(0, 0, 0.3, 1)',
        'slide-in-right':  'slide-in-right 200ms cubic-bezier(0, 0, 0.3, 1)',
        'slide-out-right': 'slide-out-right 150ms cubic-bezier(0.7, 0, 1, 1)',
        shimmer:           'shimmer 1500ms linear infinite',
        'fade-scale-in':   'fade-scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
};

export default config;
