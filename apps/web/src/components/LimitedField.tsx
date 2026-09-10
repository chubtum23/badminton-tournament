'use client';
import { useState } from 'react';
import { ui } from './ui';

/**
 * A text box that says how much room is left. maxLength alone stops the keystrokes without ever
 * saying why, which reads as a broken box; the count makes the ceiling visible before it is hit and
 * turns to a warning over the last tenth so a long tagline does not get silently clipped mid-word.
 */
export function LimitedField({ name, limit, defaultValue = '', rows, className = '', onValueChange, ...rest }: {
  name: string; limit: number; defaultValue?: string; rows?: number; className?: string;
  /** For a caller that needs to mirror what is typed, such as the sign-up form's live photo ring. */
  onValueChange?: (value: string) => void;
} & Pick<React.InputHTMLAttributes<HTMLInputElement>, 'required' | 'id'>) {
  const [used, setUsed] = useState(defaultValue.length);
  const left = limit - used;
  const shared = {
    name, defaultValue, maxLength: limit, className,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setUsed(e.target.value.length);
      onValueChange?.(e.target.value);
    },
    ...rest,
  };
  return (
    <>
      {rows ? <textarea {...shared} rows={rows} /> : <input {...shared} />}
      <span
        data-testid={`count-${name}`}
        className={`${ui.help} block text-right tabular-nums ${left <= limit / 10 ? 'text-orange-ink' : ''}`}
      >
        {used} / {limit}
      </span>
    </>
  );
}
