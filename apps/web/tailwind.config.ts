import type { Config } from 'tailwindcss';

/**
 * The GUGC club palette and type scale, taken from the design.
 *
 * Two things are worth knowing before adding a class anywhere:
 *
 * 1. Nothing in this design is rounded. Every radius is zeroed below except `full`, which the
 *    team-colour dots and status lights use. Stray `rounded-*` classes are therefore harmless.
 * 2. Pools are colour-coded throughout — the first pool reads orange, the second sky — so the
 *    tints come in matched `*-tint` / `*-ink` pairs that always meet contrast on white.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** Page ground: a warm bone, never pure white. */
        bone: '#F7F5F0',
        /** Body text and the darkest ink in the system. */
        ink: '#232A6E',
        /** The club navy: card borders, the header band, solid buttons. */
        navy: { DEFAULT: '#2B3390', line: '#4A52A8' },
        /** The one accent. Always carries `ink` text, never white. */
        orange: { DEFAULT: '#F6921E', bright: '#F6A947', tint: '#FBE3C6', wash: '#FDF3E4', ink: '#A55B0B' },
        sky: { DEFAULT: '#3BA9DC', light: '#6FC5EA', tint: '#CDE9F7', ink: '#1A6E96' },
        /**
         * Muted text, dark to light. The design's lightest grey (#9296B8) only reaches 2.9:1 on
         * white, so it is demoted to `soft` — for display-sized counts and for dimming a name that
         * is already struck through — and everyday secondary text sits on the darker two, which
         * clear AA at 11px. This is a hall screen read from a bench; it can afford the contrast.
         */
        muted: { DEFAULT: '#5E6395', strong: '#454A78', soft: '#797E9E' },
        /** Text that sits on the navy band. `dim` fails AA there, so nothing uses it. */
        onnavy: { DEFAULT: '#9BA1D4', soft: '#A3A8D6' },
        /** Hairlines inside a card, strong to faint. */
        line: { strong: '#C9CBDC', DEFAULT: '#DEDFEA', soft: '#F0EFF8' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Archivo', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'Space Grotesk', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { label: '1px', eyebrow: '1.5px', wide2: '2.5px' },
      borderRadius: { none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '9999px' },
      borderWidth: { hair: '1.5px' },
      maxWidth: {
        /** The page column. Wide enough to use a laptop screen; capped so an ultrawide monitor
            does not stretch a two-column card grid into unreadable bands. */
        shell: '1600px',
        /** Single-column reading and typing: an announcement, a sign-up form. Long lines of prose
            are harder to read, so these stay narrow even though the shell around them is wide. */
        prose: '900px',
      },
    },
  },
  plugins: [],
} satisfies Config;
