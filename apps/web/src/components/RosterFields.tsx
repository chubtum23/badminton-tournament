import { ROSTER_FIELD_LABELS } from '@/lib/teams/roster';
import { ui } from './ui';

/** The three player boxes. The box a name goes in decides the player's gender and role. */
export function RosterFields({ defaults, disabled = false }: {
  defaults?: { mixed1?: string; mixed2?: string; woman?: string };
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(['mixed1', 'mixed2', 'woman'] as const).map((key) => (
        <label key={key} className={ui.label}>{ROSTER_FIELD_LABELS[key]}
          <input name={key} required maxLength={60} defaultValue={defaults?.[key] ?? ''} disabled={disabled} className={ui.field} />
        </label>
      ))}
      <p className={`${ui.help} md:col-span-3`}>Your woman plays both mixed games. Your two men play the men&apos;s doubles together.</p>
    </div>
  );
}
