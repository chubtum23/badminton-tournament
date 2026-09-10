'use client';
import { ROSTER_FIELD_LABELS } from '@/lib/teams/roster';
import { PhotoField } from './PhotoField';
import { ui } from './ui';

/** The three player boxes. The box a name goes in decides the player's gender and role. */
export function RosterFields({ defaults, photos, colour = '#2B3390', disabled = false, big = false }: {
  defaults?: { mixed1?: string; mixed2?: string; woman?: string };
  /** The path already stored per role, so an edit shows what is there rather than an empty picker. */
  photos?: { mixed1?: string | null; mixed2?: string | null; woman?: string | null };
  /** Rings the photo and fills the initials fallback. */
  colour?: string;
  disabled?: boolean;
  /** Sign-up sizing: the join page is a form and nothing else, so its boxes are bigger. */
  big?: boolean;
}) {
  return (
    <div className={`grid md:grid-cols-3 ${big ? 'gap-6' : 'gap-4'}`}>
      {(['mixed1', 'mixed2', 'woman'] as const).map((key) => (
        <label key={key} className={big ? ui.labelLg : ui.label}>{ROSTER_FIELD_LABELS[key]}
          <input name={key} required maxLength={60} defaultValue={defaults?.[key] ?? ''} disabled={disabled} className={big ? ui.fieldLg : ui.field} />
          {!disabled && <PhotoField role={key} name={defaults?.[key] ?? ''} colour={colour} currentPath={photos?.[key] ?? null} />}
        </label>
      ))}
      <p className={`${ui.help} md:col-span-3 ${big ? 'text-base' : ''}`}>Your woman plays both mixed games. Your two men play the men&apos;s doubles together. Photos are optional.</p>
    </div>
  );
}
