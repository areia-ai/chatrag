'use client';

import { useState, useEffect } from 'react';

interface MobileDetectionResult {
  isMobile: boolean;
  isTablet: boolean;
  isSmallMobile: boolean;
  screenWidth: number;
  orientation: 'portrait' | 'landscape';
}

const BREAKPOINTS = {
  SMALL_MOBILE: 480,
  MOBILE: 768,
  TABLET: 1024,
} as const;

export function useMobileDetection(): MobileDetectionResult {
  const [detection, setDetection] = useState<MobileDetectionResult>({
    isMobile: false,
    isTablet: false,
    isSmallMobile: false,
    screenWidth: 0,
    orientation: 'portrait',
  });

  useEffect(() => {
    const updateDetection = () => {
      if (typeof window === 'undefined') return;

      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      
      const isMobile = screenWidth <= BREAKPOINTS.TABLET;
      const isTablet = screenWidth > BREAKPOINTS.MOBILE && screenWidth <= BREAKPOINTS.TABLET;
      const isSmallMobile = screenWidth <= BREAKPOINTS.SMALL_MOBILE;
      const orientation = screenWidth > screenHeight ? 'landscape' : 'portrait';

      setDetection({
        isMobile,
        isTablet,
        isSmallMobile,
        screenWidth,
        orientation,
      });
    };

    // Initial detection
    updateDetection();

    // Listen for window resize
    const handleResize = () => {
      updateDetection();
    };

    // Listen for orientation change with delay to account for iOS behavior
    const handleOrientationChange = () => {
      setTimeout(updateDetection, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    // Visual viewport API support for better mobile detection
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateDetection);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateDetection);
      }
    };
  }, []);

  return detection;
}

export const MOBILE_BREAKPOINTS = BREAKPOINTS; 