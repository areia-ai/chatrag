'use client';

import { useEffect } from 'react';
import { getSiteTitle } from '@/lib/env';

export function DynamicTitle() {
  useEffect(() => {
    const title = getSiteTitle();
    if (title && document.title !== title) {
      document.title = title;
    }
  }, []);

  return null;
}