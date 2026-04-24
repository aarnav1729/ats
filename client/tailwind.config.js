/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        navy: {
          50: '#f1f5f9',
          100: '#e2e8f0',
          200: '#cbd5e1',
          300: '#94a3b8',
          400: '#64748b',
          500: '#334155',
          600: '#1e293b',
          700: '#0f172a',
          800: '#0b2540',
          900: '#0a1f36',
        },
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc',
          subtle: '#f1f4f8',
          hover: '#f5f8fc',
        },
        line: {
          DEFAULT: '#e5e9f0',
          strong: '#d5dbe5',
          subtle: '#eef1f6',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
        sm: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08)',
        md: '0 2px 4px rgba(15, 23, 42, 0.06), 0 4px 8px rgba(15, 23, 42, 0.08)',
        lg: '0 4px 8px rgba(15, 23, 42, 0.08), 0 12px 24px rgba(15, 23, 42, 0.1)',
        xl: '0 8px 16px rgba(15, 23, 42, 0.1), 0 24px 48px rgba(15, 23, 42, 0.12)',
        focus: '0 0 0 3px rgba(37, 99, 235, 0.2)',
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08)',
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
    },
  },
  plugins: [],
};
