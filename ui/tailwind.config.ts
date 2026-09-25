import type { Config } from 'tailwindcss'

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // "Midnight & marigold": night by default, a day palette on the
      // toggle. Values live in index.css.
      colors: {
        bg: token('bg'),
        surface: { DEFAULT: token('surface'), raised: token('surface-raised') },
        band: token('band'),
        rule: token('rule'),
        ink: { DEFAULT: token('ink'), soft: token('ink-soft'), faint: token('ink-faint') },
        chord: token('chord'),
        glow: { DEFAULT: token('glow'), ink: token('glow-ink') },
      },
      fontFamily: {
        sans: ['"Nunito Variable"', 'Nunito', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        float: '0 10px 30px rgb(0 0 0 / 0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config
