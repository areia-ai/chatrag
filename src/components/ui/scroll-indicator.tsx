import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState, useRef } from 'react';

interface ScrollIndicatorProps {
  direction?: 'up' | 'down';
  show: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
  chatContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * A scroll indicator component with smooth scale animations
 * for both appearing and disappearing states.
 */
export function ScrollIndicator({
  direction = 'down',
  show,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
  chatContainerRef
}: ScrollIndicatorProps) {
  // Add internal state to override parent's show prop
  const [internalShow, setInternalShow] = useState(show);
  // Add a ref to track scroll timer for debouncing
  const scrollTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Add ref to track if we're handling a click
  const isClickingRef = useRef(false);
  // State for idle detection - specifically for fading after scroll inactivity
  const [isScrollIdle, setIsScrollIdle] = useState(false);
  const scrollIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  // iOS Safari detection - use lower position for scroll button
  const [isIOSSafari, setIsIOSSafari] = useState(false);

  // Detect iOS Safari on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
      setIsIOSSafari(isIOS && isSafari);
    }
  }, []);

  // The main function to handle scroll activity
  const handleScrollActivity = () => {
    // Clear any existing idle timer
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current);
    }

    // Immediately set to not idle on scroll
    setIsScrollIdle(false);

    // Set a timer to mark as idle after 5 seconds of no scrolling
    scrollIdleTimerRef.current = setTimeout(() => {
      setIsScrollIdle(true);
    }, 5000);
  };

  // Check if we're at the bottom and update internal show state
  useEffect(() => {
    // If this is the "down" indicator and we have a chatContainerRef
    if (direction === 'down' && chatContainerRef?.current) {
      const checkIfAtBottom = () => {
        // Skip check if we're handling a click
        if (isClickingRef.current) return;

        // Clear existing timer
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }

        // Debounce to prevent flickering - but with a very short delay for quicker response
        scrollTimerRef.current = setTimeout(() => {
          const container = chatContainerRef.current;
          if (!container) return;

          const { scrollTop, scrollHeight, clientHeight } = container;

          // Use a smaller threshold for "at bottom" detection
          // This means the indicator will appear sooner when scrolling up
          const isAtBottom = scrollHeight - clientHeight - scrollTop <= 5; // Reduced from 30 to 5

          // If we're at the bottom, always hide immediately
          if (isAtBottom) {
            setInternalShow(false);
          } else {
            // Otherwise, show the indicator immediately when scrolling up even slightly
            setInternalShow(true);
            // Mark as active whenever scrolling happens
            handleScrollActivity();
          }
        }, 30); // Shorter delay for faster response (reduced from 50ms)
      };

      // Run on mount and when show prop changes
      checkIfAtBottom();

      // Add scroll listener to container to check position on scroll
      const container = chatContainerRef.current;
      if (container) {
        // Add the scroll event listener
        container.addEventListener('scroll', checkIfAtBottom, { passive: true });

        // Also add a resize observer to check when container height changes
        const resizeObserver = new ResizeObserver(() => {
          checkIfAtBottom();
        });

        resizeObserver.observe(container);

        // Start the idle timer when the component mounts
        handleScrollActivity();

        return () => {
          container.removeEventListener('scroll', checkIfAtBottom);
          resizeObserver.disconnect();
          if (scrollTimerRef.current) {
            clearTimeout(scrollTimerRef.current);
          }
          if (scrollIdleTimerRef.current) {
            clearTimeout(scrollIdleTimerRef.current);
          }
        };
      }
    } else {
      // For up indicator or when no ref is provided, just use parent's show prop
      setInternalShow(show);
    }
  }, [show, direction, chatContainerRef]);

  // Effect to clean up the scroll idle timer when the component unmounts
  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
    };
  }, []);

  // Define animation variants
  const variants = {
    hidden: { opacity: 0, scale: 0 },
    visible: {
      opacity: isScrollIdle ? 0.5 : 1,
      scale: 1,
      y: direction === 'up' ? [0, 6, 0] : [0, -6, 0],
      transition: {
        y: { duration: 2, repeat: Infinity, ease: "easeInOut" },
        opacity: { duration: 0.7 },
        scale: { duration: 0.3, type: "spring", stiffness: 200 }
      }
    },
    exit: {
      opacity: 0,
      scale: 0,
      transition: {
        duration: 0.2,
        ease: "easeOut"
      }
    }
  };

  // Handle click with internal state update
  const handleClick = () => {
    // Set clicking ref to true to prevent scroll handler from showing indicator
    isClickingRef.current = true;

    // Hide immediately on click
    setInternalShow(false);

    // Reset idle state when clicked
    handleScrollActivity();

    // Then call parent's onClick handler
    onClick();

    // Reset clicking ref after a delay longer than scroll handler debounce
    setTimeout(() => {
      isClickingRef.current = false;
    }, 100);
  };

  return (
    <AnimatePresence mode="wait">
      {internalShow && (
        <motion.button
          key={`scroll-${direction}`}
          onClick={handleClick}
          onMouseEnter={() => {
            handleScrollActivity();
            onMouseEnter?.();
          }}
          onMouseLeave={onMouseLeave}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8",
            "rounded-full bg-[#EFE1D5] dark:bg-[#2F2F2F] hover:bg-[#D4C0B6]",
            "dark:hover:bg-[#424242] shadow-md z-50", // Higher z-index
            isScrollIdle && "blur-[0.8px]", // Apply blur only when idle
            direction === 'up'
              ? "top-4"
              : "-top-52 sm:-top-12", // Default: high on mobile, lower on desktop
            className
          )}
          // iOS Safari needs lower position - inline style overrides Tailwind class
          style={direction === 'down' && isIOSSafari ? { top: '-48px' } : undefined}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          aria-label={`Scroll to ${direction}`}
        >
          <ChevronDown
            className={cn(
              "w-5 h-5 text-gray-700 dark:text-gray-200",
              direction === 'up' && "rotate-180"
            )}
          />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
