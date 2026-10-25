'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function SharedChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Shared chat error:', error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen bg-[#FFFAF5] dark:bg-[#1A1A1A]">
      <main className="flex-1 flex items-center justify-center">
        <div className="container max-w-md mx-auto px-4 py-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Unable to load shared chat
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            The chat you&apos;re looking for might have been removed or is no longer accessible.
          </p>
          <div className="space-y-4">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#FF6417] hover:bg-[#E05A15] text-white dark:bg-[#2A2A2A] dark:hover:bg-[#1A1A1A] transition-colors"
            >
              Try again
            </button>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              or{' '}
              <Link
                href="/"
                className="text-[#FF6417] dark:text-[#FF8A4D] hover:underline"
              >
                return home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 
