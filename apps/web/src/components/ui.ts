/**
 * The design's vocabulary in one place.
 *
 * Everything on the night is read at arm's length from a bench, so the sizes stay generous:
 * 44px-tall controls, uppercase labels with real letter-spacing, and one loud button per form.
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
  head: 'flex flex-wrap items-center justify-between gap-3 border-b-2 border-navy px-5 py-3',
  headOrange: 'bg-orange-tint text-orange-ink',
  headSky: 'bg-sky-tint text-sky-ink',
  body: 'px-5 py-5',
  /** Dashed placeholder for a section with nothing in it yet. */
  empty: 'border-2 border-dashed border-line-strong bg-white p-7 text-center text-[13.5px] text-muted',

  // — Type ————————————————————————————————————————————————
  /** Section heading above a grid of cards. */
  h2: 'font-display text-xl font-extrabold uppercase tracking-tight',
  /** Card and field titles: small, uppercase, spaced. */
  eyebrow: 'text-xs font-bold uppercase tracking-eyebrow',
  /** A big number: stat tiles, scores, ranks. */
  figure: 'font-display font-black leading-none',
  help: 'mt-1.5 text-[12.5px] text-muted',
  /** A URL or token shown for copying. */
  code: 'break-all border-hair border-line bg-line-soft px-4 py-2.5 text-[13px] text-ink',

  // — Forms ———————————————————————————————————————————————
  label: 'block text-[11.5px] font-bold uppercase tracking-label text-muted',
  field: 'mt-1.5 w-full border-hair border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-navy disabled:bg-line-soft disabled:text-muted',
  /** Narrow inline input or select sitting in a row of controls. */
  fieldSm: 'border-hair border-line bg-white px-2 py-1.5 text-[13px] text-ink outline-none focus:border-navy',
  checkbox: 'h-4 w-4 accent-navy',
  /** A checkbox and its wording. */
  check: 'flex items-center gap-2.5 text-[13px] font-semibold text-muted',

  // — Buttons —————————————————————————————————————————————
  primary: 'bg-orange px-6 py-3 text-xs font-bold uppercase tracking-label text-ink hover:bg-orange-bright',
  solid: 'bg-navy px-6 py-3 text-xs font-bold uppercase tracking-label text-white hover:bg-ink',
  secondary: 'border-hair border-navy px-4 py-2.5 text-xs font-bold uppercase tracking-label text-navy hover:bg-line-soft',
  danger: 'border-hair border-red-400 px-4 py-2.5 text-xs font-bold uppercase tracking-label text-red-700 hover:bg-red-50',
  /** The smallest control: sits inline in a dense row without setting the row's height. */
  tiny: 'border-hair border-line-strong px-2.5 py-1 text-[11px] font-bold uppercase tracking-label text-muted-strong hover:border-navy hover:text-navy',

  // — Status ——————————————————————————————————————————————
  pillDone: 'bg-navy px-3 py-1 text-[11px] font-bold uppercase tracking-label text-orange',
  pillTodo: 'bg-orange-tint px-3 py-1 text-[11px] font-bold uppercase tracking-label text-orange-ink',
  pillLocked: 'bg-line-soft px-3 py-1 text-[11px] font-bold uppercase tracking-label text-muted',
  pillLive: 'bg-orange px-3 py-1 text-[11px] font-bold uppercase tracking-label text-ink',
  /** A note the organiser has to act on. */
  warn: 'border-hair border-orange bg-orange-wash px-4 py-3 text-[13px] text-orange-ink',
  alarm: 'border-hair border-red-400 bg-red-50 px-4 py-3 text-[13px] text-red-800',
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
  `${poolTone(index).tag} px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-label`;
