/**
 * The design's vocabulary in one place.
 *
 * Everything on the night is read at arm's length from a bench — a phone propped on a bag, a
 * laptop on the scorer's table — so the scale is deliberately generous: 48px-tall controls,
 * 15-16px body copy, and uppercase labels with real letter-spacing. Nothing here is sized for a
 * dense desktop dashboard, because that is not where it gets used.
 *
 * Three button weights, and the difference is what the button does rather than how it looks:
 * `primary` (orange) is the one action a screen is for, `solid` (navy) is a secondary commit
 * inside a card, `secondary` is everything reversible. `danger` is the only one that is not
 * about emphasis — it is about consequence.
 */
export const ui = {
  // — Surfaces —————————————————————————————————————————————
  /** The card shell. Pair with `head` + `body`, or use `card` with padding for a plain panel. */
  card: 'border-2 border-navy bg-white',
  /** A card's title bar. `headOrange`/`headSky` tint it to a pool's colour. */
  head: 'flex flex-wrap items-center justify-between gap-3 border-b-2 border-navy px-7 py-4',
  headOrange: 'bg-orange-tint text-orange-ink',
  headSky: 'bg-sky-tint text-sky-ink',
  body: 'px-7 py-7',
  /** Dashed placeholder for a section with nothing in it yet. */
  empty: 'border-2 border-dashed border-line-strong bg-white p-10 text-center text-[15px] text-muted',

  // — Type ————————————————————————————————————————————————
  /** Section heading above a grid of cards. */
  h2: 'font-display text-2xl font-extrabold uppercase tracking-tight',
  /** Card and field titles: small, uppercase, spaced. */
  eyebrow: 'text-[13px] font-bold uppercase tracking-eyebrow',
  /** A big number: stat tiles, scores, ranks. */
  figure: 'font-display font-black leading-none',
  help: 'mt-2 text-sm text-muted',
  /** A URL or token shown for copying. */
  code: 'break-all border-hair border-line bg-line-soft px-4 py-3 text-sm text-ink',

  // — Forms ———————————————————————————————————————————————
  label: 'block text-[13px] font-bold uppercase tracking-label text-muted',
  field: 'mt-2 w-full border-hair border-line bg-white px-4 py-3 text-base text-ink outline-none focus:border-navy disabled:bg-line-soft disabled:text-muted',
  /** Narrow inline input or select sitting in a row of controls. */
  fieldSm: 'border-hair border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-navy',
  checkbox: 'h-5 w-5 accent-navy',
  /** A checkbox and its wording. */
  check: 'flex items-center gap-3 text-[15px] font-semibold text-muted',

  // — Buttons —————————————————————————————————————————————
  primary: 'bg-orange px-7 py-3.5 text-sm font-bold uppercase tracking-label text-ink hover:bg-orange-bright',
  solid: 'bg-navy px-7 py-3.5 text-sm font-bold uppercase tracking-label text-white hover:bg-ink',
  secondary: 'border-hair border-navy px-5 py-3 text-sm font-bold uppercase tracking-label text-navy hover:bg-line-soft',
  danger: 'border-hair border-red-400 px-5 py-3 text-sm font-bold uppercase tracking-label text-red-700 hover:bg-red-50',
  /** The smallest control: sits inline in a dense row without setting the row's height. */
  tiny: 'border-hair border-line-strong px-3 py-1.5 text-xs font-bold uppercase tracking-label text-muted-strong hover:border-navy hover:text-navy',

  // — Status ——————————————————————————————————————————————
  pillDone: 'bg-navy px-3.5 py-1.5 text-xs font-bold uppercase tracking-label text-orange',
  pillTodo: 'bg-orange-tint px-3.5 py-1.5 text-xs font-bold uppercase tracking-label text-orange-ink',
  pillLocked: 'bg-line-soft px-3.5 py-1.5 text-xs font-bold uppercase tracking-label text-muted',
  pillLive: 'bg-orange px-3.5 py-1.5 text-xs font-bold uppercase tracking-label text-ink',
  /** A note the organiser has to act on. */
  warn: 'border-hair border-orange bg-orange-wash px-5 py-4 text-[15px] text-orange-ink',
  alarm: 'border-hair border-red-400 bg-red-50 px-5 py-4 text-[15px] text-red-800',
} as const;

/**
 * Pools read by colour across every screen — the tables, the fixtures, the match headers and the
 * draw tree all tint from here, so a pool looks the same wherever it turns up. The colours cycle
 * for a tournament with more than four pools; the pool's name is always shown too, so the cycle
 * repeating is a loss of shorthand rather than of meaning.
 */
const POOL_TONES = [
  { head: ui.headOrange, tag: 'bg-orange-tint text-orange-ink', band: 'bg-orange-wash' },
  { head: ui.headSky, tag: 'bg-sky-tint text-sky-ink', band: 'bg-sky-tint/40' },
  { head: 'bg-line-soft text-navy', tag: 'bg-line-soft text-navy', band: 'bg-line-soft/60' },
  { head: 'bg-orange-wash text-ink', tag: 'bg-orange-wash text-ink', band: 'bg-orange-wash/60' },
] as const;

export function poolTone(index: number) {
  return POOL_TONES[((index % POOL_TONES.length) + POOL_TONES.length) % POOL_TONES.length]!;
}

/** The tag that names a pool inline, in that pool's colour. */
export const poolTag = (index: number) =>
  `${poolTone(index).tag} px-3 py-1 text-xs font-bold uppercase tracking-label`;
