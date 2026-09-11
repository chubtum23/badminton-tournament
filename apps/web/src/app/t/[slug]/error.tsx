'use client';
import { useParams } from 'next/navigation';
import { ErrorCard } from '@/components/ErrorCard';

/**
 * A tournament page that failed. This boundary sits inside the tournament's layout, so the band
 * and tabs stay up around the card and every other page is still one tap away.
 */
export default function TournamentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { slug } = useParams<{ slug: string }>();
  return <ErrorCard error={error} reset={reset} backHref={`/t/${slug}`} backLabel="Back to the live page" />;
}
