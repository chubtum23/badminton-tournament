'use client';
import type { ReactNode } from 'react';

/** A submit button that asks for confirmation before letting its form through. */
export function ConfirmButton({ message, className, children }: {
  message: string; className?: string; children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
