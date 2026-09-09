import type { Metadata } from 'next';
import { Archivo, Space_Grotesk } from 'next/font/google';
import './globals.css';

// Archivo carries every heading and every number that matters (scores, ranks, stat tiles);
// Space Grotesk carries the interface. Both are self-hosted by next/font, so there is no
// render-blocking stylesheet and no flash of a fallback face.
const display = Archivo({ subsets: ['latin'], weight: ['600', '700', '800', '900'], variable: '--font-display', display: 'swap' });
const body = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = { title: 'Tournament', description: 'Live badminton tournament' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
