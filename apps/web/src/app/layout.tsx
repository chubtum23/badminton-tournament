import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Tournament', description: 'Live badminton tournament' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
