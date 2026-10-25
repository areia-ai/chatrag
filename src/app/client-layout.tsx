'use client';

import React from 'react';
import { Inter, Merriweather, Source_Code_Pro } from "next/font/google";
import { Atkinson_Hyperlegible } from "next/font/google";
import { Lexend } from "next/font/google";
import { Open_Sans, Lato } from "next/font/google";
import "./globals.css";
import { ThemeProviderWrapper } from "@/components/theme-provider-wrapper";
import { AuthProvider, useAuth } from '@/components/providers/auth-provider';
import { ModelProvider } from '@/components/providers/model-provider';
import { ArtifactProvider } from '@/components/providers/artifact-provider';
import { clsx } from 'clsx';
import { cn } from '@/lib/utils';
import { TextSizeProvider } from '@/components/providers/text-size-provider';
import { FontProvider } from '@/components/providers/font-provider';
import { LanguageProvider } from '@/components/providers/language-provider';
import { Sidebar } from '@/components/ui/sidebar';
import { NotificationSoundListener } from '@/components/ui/notification-sound';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SourcesProvider, useSources } from '@/components/providers/sources-provider';
import { SourcesButton } from '@/components/ui/sources-button';
import { SourcesSidebar } from '@/components/ui/sources-sidebar';
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from '@/components/ui/toaster';
import { SidebarWrapper } from '@/components/ui/sidebar-wrapper';
import { MobileToolsProvider } from '@/contexts/mobile-tools-context';
import { DynamicTitle } from '@/components/dynamic-title';
import { MotionConfig } from 'framer-motion';

const inter = Inter({ subsets: ["latin"] });
const merriweather = Merriweather({ 
  weight: ['300', '400', '700'],
  subsets: ['latin'],
  variable: '--font-merriweather',
});
const sourceCodePro = Source_Code_Pro({
  subsets: ['latin'],
  variable: '--font-source-code-pro',
});
const atkinsonHyperlegible = Atkinson_Hyperlegible({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-atkinson-hyperlegible',
});
const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-lexend',
});
const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-open-sans',
});
const lato = Lato({
  weight: ['300', '400', '700'],
  subsets: ['latin'],
  variable: '--font-lato',
});

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const isPricingPage = pathname?.startsWith('/pricing');

  return (
    <html lang="en" suppressHydrationWarning className={cn(
      "h-full",
      merriweather.variable,
      sourceCodePro.variable,
      atkinsonHyperlegible.variable,
      lexend.variable,
      openSans.variable,
      lato.variable
    )}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
        {/* Disable noisy console logs in dev when requested to prevent performance degradation */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var disable = ${JSON.stringify(process.env.NEXT_PUBLIC_DISABLE_DEBUG_LOGS === 'true')};
                  if (disable) {
                    var noop = function(){};
                    console.log = noop;
                    console.debug = noop;
                    console.warn = noop;
                    console.time = noop;
                    console.timeEnd = noop;
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* Fallback favicon links in case metadata doesn't work */}
        <link rel="icon" href={process.env.NEXT_PUBLIC_FAVICON_URL || '/favicon.ico'} />
        <link rel="shortcut icon" href={process.env.NEXT_PUBLIC_FAVICON_URL || '/favicon.ico'} />
        <link rel="apple-touch-icon" href={process.env.NEXT_PUBLIC_FAVICON_URL || '/favicon.ico'} />
        <style>{`
          :root {
            --removed-body-scroll-bar-size: 0px;
            --vh: 1dvh; /* Use dynamic viewport height for mobile */
            --safe-area-inset-top: env(safe-area-inset-top, 0px);
            --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
            --safe-area-inset-left: env(safe-area-inset-left, 0px);
            --safe-area-inset-right: env(safe-area-inset-right, 0px);
          }
          
          html.light {
            --bg-color: #FFF1E5;
          }
          
          html.dark {
            --bg-color: #1A1A1A;
          }
          
          html, body {
            height: 100dvh; /* Use dynamic viewport height */
            overflow: hidden;
            background-color: var(--bg-color);
            /* Prevent zooming on iOS when inputs are focused */
            touch-action: manipulation;
          }
          
          #root-layout {
            height: 100dvh; /* Use dynamic viewport height */
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background-color: var(--bg-color);
          }
          
          .main-content {
            position: relative;
            height: 100%;
            overflow: hidden;
            background-color: var(--bg-color);
          }

          /* Enhanced mobile fixes for better iOS and Android support */
          @supports (-webkit-touch-callout: none) {
            /* iOS Safari specific fixes */
            html, body {
              height: -webkit-fill-available;
              height: 100dvh;
            }
            
            #root-layout {
              min-height: -webkit-fill-available;
              min-height: 100dvh;
            }
          }

          /* Android Chrome fixes */
          @supports (not (-webkit-touch-callout: none)) and (-webkit-appearance: none) {
            html, body {
              height: 100dvh;
            }
            
            #root-layout {
              height: 100dvh;
            }
          }

          /* Common mobile keyboard handling */
          @media (max-width: 768px) {
            body.keyboard-visible {
              height: 100dvh;
              overflow: hidden;
            }
            
            /* Ensure safe area padding is applied */
            .mobile-safe-area-bottom {
              padding-bottom: var(--safe-area-inset-bottom);
            }
            
            .mobile-safe-area-top {
              padding-top: var(--safe-area-inset-top);
            }
          }
          
          /* Auth page background fix */
          body div[id="root-layout"] > div > div > div > main {
            background-color: var(--bg-color);
          }

          /* Improved scrollbar positioning */
          .scroll-container::-webkit-scrollbar,
          .scrollbar::-webkit-scrollbar,
          .chat-message-container::-webkit-scrollbar {
            position: absolute;
            right: 0;
            width: 8px;
          }

          /* Ensure consistent scrollbar width */
          ::-webkit-scrollbar {
            width: 8px !important;
          }
          
          /* Chat container fixes */
          .chat-container {
            scrollbar-gutter: stable;
            padding-right: 0 !important;
          }
          
          /* Remove padding when sidebar is open */
          body.artifact-sidebar-open .chat-container {
            padding-right: 0 !important;
          }

          /* Fix for artifact sidebar scrollbar gap */
          body.artifact-sidebar-open .chat-message-container {
            padding-right: 0 !important;
            margin-right: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            right: 0 !important;
          }

          /* Ensure scrollbar is visible in chat-message-container */
          .chat-message-container {
            scrollbar-gutter: stable;
            overflow-y: auto !important;
          }

          /* Scrollbar hover effect */
          .chat-message-container:hover::-webkit-scrollbar-thumb {
            background-color: rgba(155, 155, 155, 0.8);
          }

          :root.sidebar-hover .scrollbar {
            transition: scrollbar-color 0.2s ease;
          }
        `}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Set correct theme
                let theme = localStorage.getItem('ui-theme');
                if (!theme) {
                  theme = 'dark';
                  localStorage.setItem('ui-theme', theme);
                }
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(theme);
                
                // Enhanced mobile viewport height handling
                function setMobileViewportVars() {
                  // Use dynamic viewport height for mobile devices
                  let vh = window.innerHeight * 0.01;
                  document.documentElement.style.setProperty('--vh', \`\${vh}px\`);
                  
                  // Set safe area variables for better mobile support
                  if (CSS.supports('height: env(safe-area-inset-top)')) {
                    document.documentElement.style.setProperty('--safe-area-inset-top', 'env(safe-area-inset-top)');
                    document.documentElement.style.setProperty('--safe-area-inset-bottom', 'env(safe-area-inset-bottom)');
                    document.documentElement.style.setProperty('--safe-area-inset-left', 'env(safe-area-inset-left)');
                    document.documentElement.style.setProperty('--safe-area-inset-right', 'env(safe-area-inset-right)');
                  }
                }
                
                // Set initially and add comprehensive event listeners
                setMobileViewportVars();
                window.addEventListener('resize', setMobileViewportVars);
                window.addEventListener('orientationchange', () => {
                  setTimeout(setMobileViewportVars, 100); // Delay for orientation change
                });
                
                // Enhanced mobile keyboard handling
                if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                  let keyboardHeight = 0;
                  
                  // Track keyboard visibility
                  window.addEventListener('focusin', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                      document.body.classList.add('keyboard-visible');
                      
                      // For iOS, adjust viewport when keyboard appears
                      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                        // Small delay to let keyboard fully appear
                        setTimeout(() => {
                          const currentHeight = window.innerHeight;
                          if (currentHeight < window.screen.height * 0.75) {
                            keyboardHeight = window.screen.height - currentHeight;
                            document.documentElement.style.setProperty('--keyboard-height', \`\${keyboardHeight}px\`);
                          }
                        }, 150);
                      }
                    }
                  });
                  
                  window.addEventListener('focusout', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                      document.body.classList.remove('keyboard-visible');
                      
                      // Reset viewport after keyboard disappears
                      setTimeout(() => {
                        setMobileViewportVars();
                        document.documentElement.style.removeProperty('--keyboard-height');
                      }, 150);
                    }
                  });
                  
                  // Handle visual viewport API for better keyboard detection
                  if (window.visualViewport) {
                    window.visualViewport.addEventListener('resize', () => {
                      setMobileViewportVars();
                    });
                  }
                }
                
                // Detect Chrome desktop at mobile sizes
                function detectDesktopMobileSize() {
                  const isDesktop = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
                  const isSmallScreen = window.innerWidth <= 639;
                  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                  
                  // Remove previous classes
                  document.body.classList.remove('desktop-mobile-size', 'chrome-desktop-mobile');
                  
                  if (isDesktop && isSmallScreen && !hasTouch) {
                    // This is a desktop browser at mobile size
                    document.body.classList.add('desktop-mobile-size');
                    
                    // Additional check for Chrome specifically
                    const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
                    if (isChrome) {
                      document.body.classList.add('chrome-desktop-mobile');
                    }
                  }
                  
                  // Debug info
                  if (window.location.search.includes('debug=css')) {
                    console.log('Desktop detection:', {
                      isDesktop,
                      isSmallScreen,
                      hasTouch,
                      pointerFine: window.matchMedia('(pointer: fine)').matches,
                      hoverHover: window.matchMedia('(hover: hover)').matches,
                      bodyClasses: document.body.classList.toString()
                    });
                  }
                }
                
                // Run detection on load and resize
                detectDesktopMobileSize();
                window.addEventListener('resize', detectDesktopMobileSize);
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body
        className={clsx(
          inter.className,
          "font-sans antialiased",
          "text-gray-900 dark:text-gray-100"
        )}
        suppressHydrationWarning
      >
        <div id="root-layout">
          <MotionConfig
            reducedMotion={process.env.NEXT_PUBLIC_REDUCED_MOTION === 'true' ? 'always' : 'never'}
          >
            <ThemeProviderWrapper>
              <AuthProvider>
                <ModelProvider>
                  <TextSizeProvider>
                    <FontProvider>
                      <LanguageProvider>
                        <ArtifactProvider>
                          <SourcesProvider>
                            <MobileToolsProvider>
                              <DynamicTitle />
                              <NotificationSoundListener />
                            {/* Debug helper - this lets us verify the NotificationSoundListener is actually in the DOM */}
                            <script
                              dangerouslySetInnerHTML={{
                                __html: `
                                  setTimeout(() => {
                                    const soundComponent = document.querySelector('div[class*="NotificationSound"]');
                                    if (soundComponent) {
                                      console.log('NotificationSoundListener found in DOM');
                                    } else {
                                      console.warn('NotificationSoundListener NOT found in DOM - notifications may not work');
                                    }
                                  }, 3000);
                                `,
                              }}
                            />
                            <Toaster />
                            <div className="group/root" data-state="active">
                              <SidebarWrapper 
                                isSidebarOpen={isSidebarOpen}
                                setIsSidebarOpen={setIsSidebarOpen}
                              />
              <main className={`main-content scrollbar
                scrollbar-w-3
                scrollbar-track-transparent dark:scrollbar-track-transparent
                scrollbar-thumb-[#EFE1D5]
                dark:scrollbar-thumb-[#2F2F2F]
                group-data-[state=dimmed]/root:scrollbar-thumb-[#EFE1D5]
                group-data-[state=dimmed]/root:dark:scrollbar-thumb-[#2F2F2F]
                hover:scrollbar-thumb-[#D4C0B6]
                hover:dark:scrollbar-thumb-[#424242]
                bg-[#FFF1E5] dark:bg-[#1A1A1A]
                w-full h-full`}
              >
                {children}
              </main>
                              <SourcesSidebarRenderer />
                            </div>
                            </MobileToolsProvider>
                          </SourcesProvider>
                        </ArtifactProvider>
                      </LanguageProvider>
                    </FontProvider>
                  </TextSizeProvider>
                </ModelProvider>
              </AuthProvider>
            </ThemeProviderWrapper>
          </MotionConfig>
        </div>
        <Analytics />
        {/* Portal container for dropdowns with maximum z-index */}
        <div id="radix-portal-container" style={{ position: 'fixed', top: 0, left: 0, zIndex: 2147483647, pointerEvents: 'none' }} />
      </body>
    </html>
  );
}

// Separate component to render the sidebar
function SourcesSidebarRenderer() {
  const { isSourcesOpen, sources, trackedSetIsSourcesOpen } = useSources();
  
  // This function is no longer needed as the SourcesSidebar now handles 
  // the close action directly through the context
  
  return (
    <SourcesSidebar
      sources={sources}
    />
  );
}
