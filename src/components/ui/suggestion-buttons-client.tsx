'use client';

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface SuggestionItem {
  id?: string;
  text: string;
}

interface SuggestionGroup {
  id?: string;
  label: string;
  iconComponent: React.ReactNode;
  items: SuggestionItem[];
}

interface SuggestionButtonsClientProps {
  suggestionGroups: SuggestionGroup[];
  onSuggestionClick: (category: string, item: string) => void;
}

export function SuggestionButtonsClient({ suggestionGroups, onSuggestionClick }: SuggestionButtonsClientProps) {
  // Initialize activeCategory from sessionStorage if available (client-side only)
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    if (typeof window === 'undefined') return "";
    return sessionStorage.getItem('activeSuggestionCategory') || "";
  });
  const [isMobile, setIsMobile] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isMobileDropdownActive, setIsMobileDropdownActive] = useState(false);
  const [isMobileDropdownClosing, setIsMobileDropdownClosing] = useState(false);
  const [isSafariDesktop, setIsSafariDesktop] = useState(false);
  // Swipe-to-close state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  // Velocity tracking for smooth inertia
  const lastMoveTimeRef = useRef(0);
  const lastMoveYRef = useRef(0);
  const velocityRef = useRef(0);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mobileOverlayRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  // Check if mobile on mount and window resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    // Check if Safari desktop
    const checkSafariDesktop = () => {
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      const isDesktop = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
      const isSmallScreen = window.innerWidth < 640;
      setIsSafariDesktop(isSafari && isDesktop && isSmallScreen);
    };

    checkMobile();
    checkSafariDesktop();
    window.addEventListener('resize', () => {
      checkMobile();
      checkSafariDesktop();
    });

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('resize', checkSafariDesktop);
    };
  }, []);

  // Add keyboard detection for mobile
  useEffect(() => {
    if (!isMobile) return;

    const handleResize = () => {
      // On mobile, if the window height decreases significantly, keyboard is likely open
      const windowHeight = window.innerHeight;
      const screenHeight = window.screen.height;
      const keyboardThreshold = screenHeight * 0.75; // If viewport is less than 75% of screen, keyboard is open

      const keyboardIsOpen = windowHeight < keyboardThreshold;
      setIsKeyboardOpen(keyboardIsOpen);

      // Add/remove keyboard class for CSS targeting
      if (keyboardIsOpen) {
        document.body.classList.add('keyboard-open');
      } else {
        document.body.classList.remove('keyboard-open');
      }
    };

    // Check initial state
    handleResize();

    // Listen for viewport changes
    window.addEventListener('resize', handleResize);

    // For iOS Safari, also listen to visual viewport API if available
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      document.body.classList.remove('keyboard-open');
    };
  }, [isMobile]);

  // Handle hydration and restore saved category
  useEffect(() => {
    document.body.classList.add('suggestions-are-visible');
    // Try to restore active category from sessionStorage
    // Listen for form-submitting class on body to hide dropdowns when submitting
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const body = document.body;
          if (body.classList.contains('form-submitting')) {
            setActiveCategory("");
            setIsMobileDropdownActive(false);
          }
        }
      });
    });

    observer.observe(document.body, { attributes: true });

    return () => {
      observer.disconnect();
      document.body.classList.remove('suggestions-are-visible');
    };
  }, []);

  // Add Safari desktop class to body
  useEffect(() => {
    if (isSafariDesktop) {
      document.body.classList.add('safari-desktop');
    } else {
      document.body.classList.remove('safari-desktop');
    }

    return () => {
      document.body.classList.remove('safari-desktop');
    };
  }, [isSafariDesktop]);

  // Save active category to sessionStorage when it changes
  useEffect(() => {
    if (activeCategory) {
      sessionStorage.setItem('activeSuggestionCategory', activeCategory);
    } else {
      sessionStorage.removeItem('activeSuggestionCategory');
    }
  }, [activeCategory]);

  // Mobile dropdown state management
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsMobileDropdownActive(isMobile ? !!activeCategory : false);
    });

    // Reset drag state when dropdown opens
    if (activeCategory && isMobile) {
      setDragDeltaY(0);
      setDragStartY(0);
      setIsDragging(false);
    }

    return () => cancelAnimationFrame(frame);
  }, [activeCategory, isMobile]);

  // ANDROID FIX: Dynamically measure #mobile-dock height and set CSS variable for dropdown positioning
  useEffect(() => {
    if (!isMobile) return;

    const updateMobileDockHeight = () => {
      const mobileDock = document.getElementById('mobile-dock');
      if (mobileDock) {
        const height = mobileDock.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--mobile-dock-height', `${height}px`);
      }
    };

    // Initial measurement
    updateMobileDockHeight();

    // Re-measure on resize and when dropdown state changes
    window.addEventListener('resize', updateMobileDockHeight);

    // Use ResizeObserver for more accurate tracking of the dock element
    const mobileDock = document.getElementById('mobile-dock');
    let resizeObserver: ResizeObserver | null = null;
    if (mobileDock && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateMobileDockHeight);
      resizeObserver.observe(mobileDock);
    }

    return () => {
      window.removeEventListener('resize', updateMobileDockHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [isMobile, isMobileDropdownActive]);

  // Handle category button click
  const handleCategoryClick = (category: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    // Toggle between active or inactive if clicking the same category
    if (activeCategory === category) {
      setActiveCategory("");
    } else {
      setActiveCategory(category);

      // On desktop, scroll to center the active button
      if (!isMobile && scrollContainerRef.current) {
        const button = buttonRefs.current[category];
        if (button) {
          const container = scrollContainerRef.current;
          const buttonRect = button.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();

          const scrollPosition = button.offsetLeft - (containerRect.width / 2) + (buttonRect.width / 2);
          container.scrollTo({
            left: scrollPosition,
            behavior: 'smooth'
          });
        }
      }
    }
  };

  // Handle selecting a suggestion item
  const handleItemClick = (category: string, item: string) => {
    // Use the item text directly as it's now a complete question
    onSuggestionClick(category, item);

    // Close dropdown after selection
    setActiveCategory("");
    setIsMobileDropdownActive(false);
  };

  const closeMobileDropdown = () => {
    // Start closing animation
    setIsMobileDropdownClosing(true);
    // Wait for animation to complete before actually closing
    setTimeout(() => {
      setActiveCategory("");
      setIsMobileDropdownActive(false);
      setIsMobileDropdownClosing(false);
    }, 300); // Match animation duration
  };

  // Mobile: close when tapping/clicking outside the sheet (robust across iOS Safari/Chrome and Android)
  // Use touchstart/mousedown/pointerdown + preventDefault to avoid "click-through" reopening.
  const handleMobileOverlayInteract = (
    event:
      | React.PointerEvent<HTMLDivElement>
      | React.MouseEvent<HTMLDivElement>
      | React.TouchEvent<HTMLDivElement>
  ) => {
    const target = event.target as Node;
    // If the tap is inside the sheet, do nothing
    if (mobileDropdownRef.current?.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    closeMobileDropdown();
  };

  // Radix-style outside press handling for mobile sheet:
  // Listen at the document level (capture) so it works even if the overlay/backdrop
  // doesn't receive the event due to stacking contexts or touch event quirks.
  useEffect(() => {
    if (!isMobile || !isMobileDropdownActive) return;

    const onOutsidePress = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;

      // If the press is inside the sheet, ignore it.
      if (mobileDropdownRef.current?.contains(target)) return;

      closeMobileDropdown();
    };

    // Capture phase to behave like Radix "outside press"
    document.addEventListener('pointerdown', onOutsidePress, true);
    document.addEventListener('touchstart', onOutsidePress, true);
    document.addEventListener('mousedown', onOutsidePress, true);

    return () => {
      document.removeEventListener('pointerdown', onOutsidePress, true);
      document.removeEventListener('touchstart', onOutsidePress, true);
      document.removeEventListener('mousedown', onOutsidePress, true);
    };
  }, [isMobile, isMobileDropdownActive]);

  // Handle close button click
  const handleCloseClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeMobileDropdown();
  };

  // Swipe-to-close handlers
  const handleDragStart = (event: React.TouchEvent | React.PointerEvent) => {
    // Get the Y coordinate from touch or pointer event
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const now = Date.now();

    setDragStartY(clientY);
    setDragDeltaY(0);
    setIsDragging(true);

    // Initialize velocity tracking
    lastMoveTimeRef.current = now;
    lastMoveYRef.current = clientY;
    velocityRef.current = 0;
  };

  const handleDragMove = (event: React.TouchEvent | React.PointerEvent) => {
    if (!isDragging) return;

    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const now = Date.now();
    const delta = clientY - dragStartY;

    // Calculate velocity (pixels per millisecond)
    const timeDelta = now - lastMoveTimeRef.current;
    if (timeDelta > 0) {
      const moveDelta = clientY - lastMoveYRef.current;
      const instantVelocity = moveDelta / timeDelta;
      // Smooth velocity using exponential moving average
      velocityRef.current = velocityRef.current * 0.7 + instantVelocity * 0.3;
    }

    // Update tracking refs
    lastMoveTimeRef.current = now;
    lastMoveYRef.current = clientY;

    // Only allow dragging down (positive delta), clamp negative values to 0
    setDragDeltaY(Math.max(0, delta));
  };

  const handleDragEnd = (event: React.TouchEvent | React.PointerEvent) => {
    if (!isDragging) return;

    const CLOSE_THRESHOLD = 80; // pixels needed to close
    const VELOCITY_THRESHOLD = 0.5; // pixels per ms (fast flick)

    const velocity = velocityRef.current;

    // Close if: swiped far enough OR fast flick downward
    const shouldClose = dragDeltaY > CLOSE_THRESHOLD ||
      (dragDeltaY > 30 && velocity > VELOCITY_THRESHOLD);

    // Always stop dragging
    setIsDragging(false);
    velocityRef.current = 0;

    if (shouldClose) {
      // When closing: DON'T reset dragDeltaY yet - let close animation handle it
      // The dragDeltaY will be reset when the component unmounts or dropdown reopens
      closeMobileDropdown();
    } else {
      // When NOT closing: reset drag position to snap back
      setDragStartY(0);
      setDragDeltaY(0);
    }
  };

  // Add an effect to handle clicks outside the dropdown (desktop only)
  useEffect(() => {
    if (!activeCategory || isMobile) return;

    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking on a suggestion button or dropdown
      const target = event.target as Node;
      const isInsideSuggestionUI = Array.from(document.querySelectorAll('.suggestion-button, .suggestion-dropdown-menu')).some(el =>
        el.contains(target)
      );

      if (!isInsideSuggestionUI) {
        setActiveCategory("");
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeCategory, isMobile]);

  // Handle escape key to close mobile dropdown
  useEffect(() => {
    if (!isMobileDropdownActive) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCategory("");
        setIsMobileDropdownActive(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileDropdownActive]);

  const activeGroup = suggestionGroups.find(group => group.label === activeCategory);

  return (
    <>
      <div className={cn(
        "suggestion-buttons-container",
        // Removed keyboard hiding as it was too aggressive
        // isMobile && isKeyboardOpen && "hidden",
        isMobile && isMobileDropdownActive && "mobile-buttons-hidden",
        isSafariDesktop && "safari-desktop"
      )}>
        <div
          ref={scrollContainerRef}
          className="suggestion-buttons-list"
        >
          {suggestionGroups.map((group) => (
            <div
              key={group.label}
              className={`suggestion-group-container ${activeCategory === group.label ? 'active-group' : ''}`}
              style={{ transform: activeCategory === group.label ? (isMobile ? 'translateY(-6px)' : 'translateY(6px)') : 'none', transition: 'transform 0.15s ease' }}
            >
              <button
                ref={(el) => { buttonRefs.current[group.label] = el; }}
                type="button"
                className={`suggestion-button ${activeCategory === group.label ? 'active' : ''}`}
                onClick={(e) => handleCategoryClick(group.label, e)}
              >
                <span className="suggestion-button-icon">{group.iconComponent}</span>
                <span className="suggestion-button-label">{group.label}</span>
              </button>

              {/* Desktop dropdown */}
              {!isMobile && activeCategory === group.label && (
                <div
                  className="suggestion-dropdown-menu"
                  style={{
                    opacity: 1,
                    transform: 'translateX(-50%) translateY(0) scale(1)',
                    transformOrigin: 'top center',
                    willChange: 'opacity, transform'
                  }}
                >
                  {group.items.map((item, index) => (
                    <button
                      key={`${group.label}-${item.text}`}
                      type="button"
                      className={`suggestion-dropdown-item ${index === 0 ? 'first-item' : ''}`}
                      onClick={() => handleItemClick(activeCategory, item.text)}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Dropdown Overlay - Positioned Just Above Chat Input */}
      {isMobile && isMobileDropdownActive && activeGroup && (
        <div
          ref={mobileOverlayRef}
          className={`mobile-suggestion-overlay ${isMobileDropdownClosing ? 'mobile-overlay-closing' : ''}`}
          onPointerDown={handleMobileOverlayInteract}
          onMouseDown={handleMobileOverlayInteract}
          onTouchStart={handleMobileOverlayInteract}
          style={{ background: 'transparent' }}
        >
          <div
            className="mobile-suggestion-backdrop"
            onPointerDown={handleMobileOverlayInteract}
            onMouseDown={handleMobileOverlayInteract}
            onTouchStart={handleMobileOverlayInteract}
          />
          <div
            ref={mobileDropdownRef}
            className={`mobile-suggestion-dropdown ${isMobileDropdownClosing ? 'mobile-dropdown-closing' : ''} ${isDragging ? 'dragging' : ''}`}
            style={{
              transform: dragDeltaY > 0 ? `translateY(${dragDeltaY}px)` : undefined,
              transition: isDragging ? 'none' : undefined,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
          >
            <div className="mobile-dropdown-handle" aria-hidden="true" />
            <button
              className="mobile-dropdown-close"
              onClick={handleCloseClick}
              aria-label="Close suggestions"
              type="button"
            >
              ×
            </button>
            <div className="mobile-dropdown-header">
              <div className="mobile-dropdown-title">
                {activeGroup.label}
              </div>
            </div>
            <div className="mobile-dropdown-items" role="menu" aria-label={`${activeGroup.label} suggestions`}>
              {activeGroup.items.map((item, index) => (
                <button
                  key={`mobile-${activeGroup.label}-${item.text}`}
                  type="button"
                  className="mobile-suggestion-item"
                  onClick={() => handleItemClick(activeCategory, item.text)}
                  style={{
                    animationDelay: `${(activeGroup.items.length - 1 - index) * 0.05}s`
                  }}
                  role="menuitem"
                >
                  <span className="mobile-suggestion-text">
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .suggestion-buttons-container {
          margin-top: -2px;
          width: 100%;
          max-width: 800px;
          margin-left: auto;
          margin-right: auto;
          padding-bottom: 0px;
          will-change: transform;
          pointer-events: auto;
          transition: opacity 0.3s ease, transform 0.3s ease;
          background: transparent;
          /* Android z-index fix - create independent stacking context */
          isolation: isolate;
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
        }
        
        .suggestion-buttons-list {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          overflow-x: visible;
          padding: 0px 16px;
          gap: 8px;
        }
        

        /* Mobile specific styling - UNIVERSAL approach for all mobile browsers */
        @media (max-width: 639px) {
          /* Default: fixed positioning for standalone usage */
          .suggestion-buttons-container {
            position: fixed;
            bottom: calc(130px + env(safe-area-inset-bottom, 0px));
            left: 0;
            right: 0;
            margin: 0;
            padding: 8px 0;
            background: transparent;
            max-width: 100%;
            z-index: 50; /* Increased from 40 for Android compatibility */
          }
          
          /* When inside the mobile chat container, override to static positioning */
          /* This rule comes after and has higher specificity */
          .mobile-chat-container .mobile-suggestions-wrapper .suggestion-buttons-container {
            position: static !important;
            bottom: auto !important;
            left: auto !important;
            right: auto !important;
            margin: 0 !important;
            padding: 2px 0 4px 0 !important;
            background: transparent !important;
            max-width: 100% !important;
            z-index: 20 !important;
          }
          
          .dark .suggestion-buttons-container {
            background: transparent;
          }
          
          .suggestion-buttons-list {
            flex-wrap: nowrap;
            justify-content: flex-start;
            overflow-x: auto;
            overflow-y: visible;
            scroll-behavior: smooth;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding: 0 16px 8px 16px;
            gap: 6px;
            background: transparent;
          }
          
          .dark .suggestion-buttons-list {
            background: none;
          }
          
          .suggestion-buttons-list::-webkit-scrollbar {
            display: none;
          }
          
          .suggestion-group-container {
            flex-shrink: 0;
            min-width: max-content;
          }
          
          .suggestion-button {
            min-width: max-content;
            height: 42px !important;
            padding: 0 16px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            border-radius: 22px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
            background: linear-gradient(135deg, rgba(239, 225, 213, 0.25), rgba(239, 225, 213, 0.15)) !important;
            backdrop-filter: blur(20px) saturate(180%) !important;
            -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
            border: 1px solid rgba(212, 192, 182, 0.3) !important;
            color: #444444 !important;
          }
          
          .dark .suggestion-button {
            background: linear-gradient(135deg, rgba(47, 47, 47, 0.25), rgba(47, 47, 47, 0.15)) !important;
            backdrop-filter: blur(20px) saturate(180%) !important;
            -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
            border: 1px solid rgba(96, 96, 96, 0.3) !important;
            color: #e0e0e0 !important;
          }
          
          /* Hide buttons when mobile dropdown is active */
          .mobile-buttons-hidden {
            /* IMPORTANT: collapse layout so the menu can sit close to the input dock */
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            height: 0 !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: hidden !important;
          }
          
          /* Removed keyboard hiding as it was too aggressive */
          /* .keyboard-open .suggestion-buttons-container {
            display: none !important;
          } */
          
          /* Smooth slide-in animation for mobile */
          .suggestion-buttons-container {
            animation: slideInFromBottom 0.3s ease-out;
          }
          
          @keyframes slideInFromBottom {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          
          /* Android Chrome specific z-index and stacking context fix */
          /* This ensures suggestion buttons appear ABOVE chat input on Android */
          @supports (not (-webkit-touch-callout: none)) and (-webkit-appearance: none) {
            @media (max-width: 639px) and (pointer: coarse) {
              .suggestion-buttons-container {
                z-index: 50 !important;
                isolation: isolate !important;
                transform: translateZ(0) !important;
                -webkit-transform: translateZ(0) !important;
                /* Force hardware acceleration for proper layering */
                will-change: transform, z-index !important;
              }
            }
          }
        }
        
        /* Mobile Dropdown Overlay */
        .mobile-suggestion-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          /* Extend to full screen so backdrop covers everything including chat input area */
          bottom: 0;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          /* Position the dropdown sheet above the chat input dock */
          padding: 0 12px calc(env(safe-area-inset-bottom, 0px) + var(--mobile-input-dock-height, 88px)) 12px;
          pointer-events: auto;
          animation: mobileOverlayFadeIn 0.3s ease-out;
          z-index: 200;
          background: transparent !important;
        }
        
        /* ANDROID FIX: When inside #mobile-dock (initial view), overlay uses larger bottom padding
           to position dropdown above the stacked chat input + suggestions flex container.
           Uses dynamic --mobile-dock-height set by JavaScript for accurate positioning */
        @supports (not (-webkit-touch-callout: none)) and (-webkit-appearance: none) {
          @media (max-width: 639px) and (pointer: coarse) {
            .mobile-suggestion-overlay {
              /* Keep bottom: 0 for full coverage, use padding to position dropdown */
              bottom: 0 !important;
              padding-bottom: var(--mobile-dock-height, 200px) !important;
            }
          }
        }
        
        .mobile-suggestion-overlay.mobile-overlay-closing {
          animation: fadeOut 0.4s ease-out forwards;
        }
        
        .mobile-suggestion-overlay:has(.mobile-dropdown-closing) {
          animation: fadeOut 0.4s ease-out forwards;
        }
        
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
        
        .mobile-suggestion-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          /* No dimming - dropdown shadows provide enough visual separation */
          background: transparent;
          pointer-events: auto;
          cursor: pointer;
        }
        
        .mobile-suggestion-dropdown {
          position: relative;
          width: min(560px, 100%);
          max-height: min(62vh, 560px);
          /* Opaque surface matching app beige theme */
          background: #FFF1E5;
          border-radius: 18px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          /* Softer multi-layer shadow to reduce banding (esp. on desktop-narrow) */
          box-shadow:
            0 10px 30px rgba(0, 0, 0, 0.18),
            0 2px 10px rgba(0, 0, 0, 0.10);
          overflow: hidden;
          pointer-events: auto;
          animation: mobileDropdownSlideUp 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          margin: 0;
          /* Smooth snap-back transition for swipe-to-close */
          transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        
        /* Disable transition during active drag for immediate feedback */
        .mobile-suggestion-dropdown.dragging {
          transition: none !important;
        }
        
        .dark .mobile-suggestion-dropdown,
        [data-theme="dark"] .mobile-suggestion-dropdown {
          /* Opaque surface (no bleed-through) */
          background: #121212 !important;
          border: 1px solid rgba(255, 255, 255, 0.10) !important;
          box-shadow:
            0 12px 34px rgba(0, 0, 0, 0.55),
            0 2px 12px rgba(0, 0, 0, 0.30) !important;
        }

        .mobile-dropdown-handle {
          width: 42px;
          height: 5px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
          margin: 10px auto 0 auto;
        }

        .dark .mobile-dropdown-handle,
        [data-theme="dark"] .mobile-dropdown-handle {
          background: rgba(255, 255, 255, 0.20);
        }

        .mobile-dropdown-header {
          position: relative;
          padding: 8px 14px 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid rgba(212, 192, 182, 0.4);
        }

        .dark .mobile-dropdown-header,
        [data-theme="dark"] .mobile-dropdown-header {
          border-bottom: 1px solid rgba(255, 255, 255, 0.10);
        }

        .mobile-dropdown-title {
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.2px;
          color: rgba(0, 0, 0, 0.70);
          /* keep title centered with top-left close button (reserve both sides for symmetry) */
          padding: 0 52px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dark .mobile-dropdown-title,
        [data-theme="dark"] .mobile-dropdown-title {
          color: rgba(255, 255, 255, 0.72);
        }

        .mobile-dropdown-close {
          position: absolute !important;
          /* Anchor to the sheet itself so it sits in the top-right corner */
          top: 8px !important;
          right: 12px !important;
          left: auto !important;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: rgba(212, 192, 182, 0.3);
          border: 1px solid rgba(212, 192, 182, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
          text-align: center;
          padding-bottom: 2px; /* Shift × symbol up for visual centering */
          color: rgba(0, 0, 0, 0.68);
          cursor: pointer;
          transition: all 0.2s ease;
          z-index: 10;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        
        .dark .mobile-dropdown-close {
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.78);
        }
        
        .mobile-dropdown-close:hover {
          background: rgba(212, 192, 182, 0.5);
          transform: scale(1.05);
        }
        
        .dark .mobile-dropdown-close:hover {
          background: rgba(255, 255, 255, 0.16);
        }
        
        /* Mobile browser specific adjustments - distinguish from narrow desktop */
        @media (max-width: 639px) and (pointer: coarse) {
          .mobile-dropdown-close {
            top: 8px !important;
            right: 12px !important;
          }
          
          .mobile-dropdown-header {
            padding: 20px 14px 8px 14px !important;
          }
          
          .mobile-suggestion-dropdown.mobile-dropdown-closing {
            animation: mobileDropdownSlideDown 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards !important;
          }
        }
        
        .mobile-dropdown-items {
          padding: 10px 12px 12px 12px;
          max-height: calc(min(62vh, 560px) - 64px);
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          /* Opaque content area so underlying page never shows through */
          background: inherit;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border-radius: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .dark .mobile-dropdown-items,
        [data-theme="dark"] .mobile-dropdown-items {
          background: transparent !important;
        }
        
        .mobile-suggestion-item {
          width: 100%;
          padding: 12px 14px;
          color: rgba(0, 0, 0, 0.80);
          font-size: 14.5px;
          text-align: left;
          background: rgba(255, 224, 208, 0.5);
          border: 1px solid rgba(212, 192, 182, 0.4);
          cursor: pointer;
          transition: all 0.2s ease;
          border-radius: 14px;
          display: flex;
          align-items: center;
          min-height: 46px;
          /* keep a light entrance, but avoid heavy motion */
          opacity: 0;
          transform: translateY(10px);
          animation: mobileItemSlideUp 0.28s ease-out forwards;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        
        .dark .mobile-suggestion-item,
        [data-theme="dark"] .mobile-suggestion-item {
          color: rgba(255, 255, 255, 0.86) !important;
          background: rgba(255, 255, 255, 0.08) !important;
          border: 1px solid rgba(255, 255, 255, 0.10) !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.20) !important;
        }
        
        .mobile-suggestion-item:hover,
        .mobile-suggestion-item:active {
          background-color: rgba(255, 224, 208, 0.7);
          transform: translateY(8px) scale(0.99);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10);
        }
        
        .dark .mobile-suggestion-item:hover,
        .dark .mobile-suggestion-item:active,
        [data-theme="dark"] .mobile-suggestion-item:hover,
        [data-theme="dark"] .mobile-suggestion-item:active {
          background-color: rgba(255, 255, 255, 0.12) !important;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28) !important;
        }
        
        .mobile-suggestion-text {
          display: block;
          line-height: 1.5;
          word-wrap: break-word;
        }
        
        .mobile-suggestion-prefix {
          color: #000000;
          font-weight: 500;
        }
        
        .dark .mobile-suggestion-prefix {
          color: #ffffff;
          font-weight: 600;
        }
        
        .mobile-suggestion-suffix {
          color: inherit;
        }
        
        /* Mobile Animations */
        @keyframes mobileOverlayFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes mobileDropdownSlideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        
        @keyframes mobileDropdownSlideDown {
          from {
            transform: translateY(0);
            opacity: 1;
          }
          to {
            transform: translateY(100%);
            opacity: 0;
          }
        }
        
        .mobile-dropdown-closing {
          animation: mobileDropdownSlideDown 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards !important;
        }
        
        /* Ensure closing animation works on all mobile screen sizes */
        @media (max-width: 639px) {
          .mobile-suggestion-dropdown.mobile-dropdown-closing {
            animation: mobileDropdownSlideDown 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards !important;
          }
        }
        
        @keyframes mobileItemSlideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .suggestion-group-container {
          position: relative;
          display: inline-block;
        }
        
        /* Light mode styles */
        .suggestion-button {
          background: linear-gradient(135deg, rgba(239, 225, 213, 0.25), rgba(239, 225, 213, 0.15));
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          color: #444444;
          border: 1px solid rgba(212, 192, 182, 0.3);
          height: 42px;
          padding: 0 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          display: flex;
          align-items: center;
          transition: all 0.15s ease;
          cursor: pointer;
          white-space: nowrap;
          z-index: 20;
          position: relative;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        
        .suggestion-button:hover {
          background: linear-gradient(135deg, rgba(239, 225, 213, 0.35), rgba(239, 225, 213, 0.25));
          border-color: rgba(212, 192, 182, 0.4);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .suggestion-button.active {
          background: linear-gradient(135deg, rgba(239, 225, 213, 0.45), rgba(239, 225, 213, 0.35));
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
          border-bottom-color: transparent;
          z-index: 30;
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }
        
        /* Intermediate screen size - smaller buttons to prevent overlap */
        @media (min-width: 640px) and (max-width: 767px) {
          .suggestion-button {
            height: 38px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
        }

        /* Mobile button hover - no transform */
        @media (max-width: 639px) {
          .suggestion-button:hover {
            transform: none !important;
          }
        }
        
        /* Mobile active state - button moves UP instead of down */
        @media (max-width: 639px) {
          .suggestion-button.active {
            border-radius: 8px !important;
            border-bottom-color: rgba(0,0,0,0.05) !important;
            transform: translateY(-2px) !important;
          }
          
          .active-group {
            transform: translateY(-2px) !important;
          }
        }
        
        /* Dark mode styles */
        html.dark .suggestion-button {
          background: linear-gradient(135deg, rgba(47, 47, 47, 0.25), rgba(47, 47, 47, 0.15));
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          color: #9e9e9e;
          border: 1px solid rgba(96, 96, 96, 0.3);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        html.dark .suggestion-button:hover {
          background: linear-gradient(135deg, rgba(47, 47, 47, 0.35), rgba(47, 47, 47, 0.25));
          border-color: rgba(96, 96, 96, 0.4);
          color: #ffffff;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        html.dark .suggestion-button.active {
          background: linear-gradient(135deg, rgba(47, 47, 47, 0.45), rgba(47, 47, 47, 0.35));
          border-bottom-color: transparent;
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }

        /* Intermediate screen size - smaller buttons for dark mode */
        @media (min-width: 640px) and (max-width: 767px) {
          html.dark .suggestion-button {
            height: 38px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
        }
        
        /* Mobile dark mode active state */
        @media (max-width: 639px) {
          .dark .suggestion-button.active {
            border-bottom-color: rgba(255, 255, 255, 0.08) !important;
            transform: translateY(-2px) !important;
          }
        }
                
        .suggestion-button-icon {
          margin-right: 8px;
          display: flex;
          align-items: center;
          opacity: 0.8;
          color: inherit;
        }
        
        html.dark .suggestion-button-icon {
          opacity: 0.7;
        }
        
        .suggestion-button-label {
          white-space: nowrap;
        }
        
        /* Light mode dropdown - minimal style matching dark mode */
        .suggestion-dropdown-menu {
          position: absolute;
          top: 100%;
          left: 50%;
          width: min(340px, 90vw);
          min-width: 260px;
          max-width: 360px;
          /* Match dark mode: transparent, no container box */
          background: transparent;
          border-radius: 0;
          border: none;
          overflow: hidden;
          box-shadow: none;
          z-index: 25;
          margin-top: -1px;
          transform: translateX(-50%);
        }
        
        /* Dark mode dropdown */
        html.dark .suggestion-dropdown-menu {
          /* Opaque popover (no bleed-through) */
          background: #121212;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 12px 34px rgba(0, 0, 0, 0.42),
            0 2px 12px rgba(0, 0, 0, 0.22);
        }
        
        /* Light mode dropdown items */
        .suggestion-dropdown-item {
          width: 100%;
          padding: 12px 14px;
          color: rgba(0, 0, 0, 0.85);
          font-size: 14px;
          text-align: left;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: background-color 0.15s ease;
          border-top: 1px solid rgba(0, 0, 0, 0.08);
          position: relative;
          white-space: normal;
          line-height: 1.35;
          opacity: 0;
          transform: translateY(-8px);
          animation: cascadeIn 0.3s ease-out forwards;
        }
        
        /* Staggered animation delays for cascading effect */
        .suggestion-dropdown-item:nth-child(1) {
          animation-delay: 0.05s;
        }
        
        .suggestion-dropdown-item:nth-child(2) {
          animation-delay: 0.1s;
        }
        
        .suggestion-dropdown-item:nth-child(3) {
          animation-delay: 0.15s;
        }
        
        .suggestion-dropdown-item:nth-child(4) {
          animation-delay: 0.2s;
        }
        
        .suggestion-dropdown-item:nth-child(5) {
          animation-delay: 0.25s;
        }
        
        .suggestion-dropdown-item:nth-child(6) {
          animation-delay: 0.3s;
        }
        
        /* Keyframes for the cascading animation */
        @keyframes cascadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        /* Dark mode dropdown items */
        html.dark .suggestion-dropdown-item {
          color: rgba(255, 255, 255, 0.88);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        .suggestion-dropdown-item.first-item {
          border-top: none;
        }
        
        html.dark .suggestion-dropdown-item.first-item {
          border-top: none;
        }
        
        .suggestion-dropdown-item:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }
        
        html.dark .suggestion-dropdown-item:hover {
          background-color: rgba(255, 255, 255, 0.08);
        }
        
        .suggestion-dropdown-item:active {
          background-color: rgba(0, 0, 0, 0.05);
        }
        
        html.dark .suggestion-dropdown-item:active {
          background-color: rgba(255, 255, 255, 0.08);
        }
        
        .suggestion-group-container.active-group .suggestion-button {
          box-shadow: 0 2px 4px rgba(0,0,0,0.08);
        }

        /* Prefix/suffix styling */
        .suggestion-prefix {
          color: #000000;
          font-weight: 500;
        }

        html.dark .suggestion-prefix {
          color: #ffffff;
          font-weight: 600;
        }
        
        .suggestion-suffix {
          color: inherit;
        }

        /* Make sure dark mode is properly applied when using data-theme */
        [data-theme="dark"] .suggestion-button {
          background: linear-gradient(135deg, rgba(47, 47, 47, 0.25), rgba(47, 47, 47, 0.15));
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          color: #9e9e9e;
          border: 1px solid rgba(96, 96, 96, 0.3);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        [data-theme="dark"] .suggestion-button:hover {
          background-color: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }
        
        [data-theme="dark"] .suggestion-button.active {
          background-color: rgba(255, 255, 255, 0.05);
          border-bottom-color: transparent;
        }

        /* Intermediate screen size - smaller buttons for data-theme dark */
        @media (min-width: 640px) and (max-width: 767px) {
          [data-theme="dark"] .suggestion-button {
            height: 38px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
        }
        
        [data-theme="dark"] .suggestion-dropdown-menu {
          background-color: transparent;
          border: none;
          border-top: none;
          box-shadow: none;
        }
        
        [data-theme="dark"] .suggestion-dropdown-item {
          color: #ffffff;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        [data-theme="dark"] .suggestion-dropdown-item.first-item {
          border-top: none;
        }
        
        [data-theme="dark"] .suggestion-dropdown-item:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        
        [data-theme="dark"] .suggestion-dropdown-item:active {
          background-color: rgba(255, 255, 255, 0.08);
        }
        
        [data-theme="dark"] .suggestion-prefix {
          color: #ffffff;
          font-weight: 600;
        }
        
        /* Additional support for .dark class */
        .dark .suggestion-button {
          background: linear-gradient(135deg, rgba(47, 47, 47, 0.25), rgba(47, 47, 47, 0.15));
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          color: #9e9e9e;
          border: 1px solid rgba(96, 96, 96, 0.3);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        .dark .suggestion-button:hover {
          background-color: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }
        
        .dark .suggestion-button.active {
          background-color: rgba(255, 255, 255, 0.05);
          border-bottom-color: transparent;
        }

        /* Intermediate screen size - smaller buttons for .dark class */
        @media (min-width: 640px) and (max-width: 767px) {
          .dark .suggestion-button {
            height: 38px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
        }
        
        /* Mobile dark mode active state */
        @media (max-width: 639px) {
          .dark .suggestion-button.active {
            border-bottom-color: rgba(255, 255, 255, 0.08) !important;
            transform: translateY(-2px) !important;
          }
        }
        
        .dark .suggestion-dropdown-menu {
          background-color: transparent;
          border: none;
          border-top: none;
          box-shadow: none;
        }
        
        .dark .suggestion-dropdown-item {
          color: #ffffff;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        .dark .suggestion-dropdown-item.first-item {
          border-top: none;
        }
        
        .dark .suggestion-dropdown-item:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        
        .dark .suggestion-dropdown-item:active {
          background-color: rgba(255, 255, 255, 0.08);
        }
        
        .dark .suggestion-prefix {
          color: #ffffff;
          font-weight: 600;
        }
        
        /* For compatibility with other dark mode implementations */
        @media (prefers-color-scheme: dark) {
          :root:not(.light) .suggestion-button {
            background: linear-gradient(135deg, rgba(47, 47, 47, 0.25), rgba(47, 47, 47, 0.15));
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            color: #9e9e9e;
            border: 1px solid rgba(96, 96, 96, 0.3);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
          }
          
          :root:not(.light) .suggestion-button:hover {
            background-color: rgba(255, 255, 255, 0.03);
            border-color: rgba(255, 255, 255, 0.1);
            color: #ffffff;
          }
          
          :root:not(.light) .suggestion-button.active {
            background-color: rgba(255, 255, 255, 0.05);
            border-bottom-color: transparent;
          }
          
          :root:not(.light) .suggestion-dropdown-menu {
            background-color: transparent;
            border: none;
            border-top: none;
            box-shadow: none;
          }
          
          :root:not(.light) .suggestion-dropdown-item {
            color: #ffffff;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
          }
          
          :root:not(.light) .suggestion-dropdown-item.first-item {
            border-top: none;
          }
          
          :root:not(.light) .suggestion-dropdown-item:hover {
            background-color: rgba(255, 255, 255, 0.05);
          }
          
          :root:not(.light) .suggestion-dropdown-item:active {
            background-color: rgba(255, 255, 255, 0.08);
          }
          
          :root:not(.light) .suggestion-prefix {
            color: #ffffff;
            font-weight: 600;
          }
        }

        /* Mobile dark mode button hover - no transform */
        @media (max-width: 639px) {
          html.dark .suggestion-button:hover,
          .dark .suggestion-button:hover {
            transform: none !important;
          }
        }

      `}</style>
    </>
  );
}
