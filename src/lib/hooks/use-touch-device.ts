import { useState, useEffect } from 'react';

/**
 * Hook to detect if the current device is a touch device.
 * Uses multiple detection methods for reliability:
 * 1. 'ontouchstart' in window
 * 2. navigator.maxTouchPoints > 0
 * 3. CSS media query (pointer: coarse)
 * 
 * Also listens for changes (e.g., connecting a mouse to a tablet)
 */
export function useIsTouchDevice() {
    const [isTouchDevice, setIsTouchDevice] = useState(false);

    useEffect(() => {
        // Check for touch capability
        const checkTouch = () => {
            const hasTouch = 'ontouchstart' in window ||
                navigator.maxTouchPoints > 0 ||
                // @ts-ignore - msMaxTouchPoints is for older IE/Edge
                navigator.msMaxTouchPoints > 0;

            // Also check for coarse pointer (typical of touch screens)
            const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

            setIsTouchDevice(hasTouch || hasCoarsePointer);
        };

        checkTouch();

        // Listen for changes in pointer type (e.g., connecting a mouse to a tablet)
        const mediaQuery = window.matchMedia('(pointer: coarse)');
        const handleChange = () => checkTouch();

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleChange);
        } else {
            // Fallback for older browsers
            mediaQuery.addListener(handleChange);
        }

        return () => {
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener('change', handleChange);
            } else {
                mediaQuery.removeListener(handleChange);
            }
        };
    }, []);

    return isTouchDevice;
}

/**
 * Utility function to check if the device is touch-capable (non-hook version).
 * Useful for one-time checks outside of React components.
 */
export function isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;

    return 'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-ignore - msMaxTouchPoints is for older IE/Edge
        navigator.msMaxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches;
}
