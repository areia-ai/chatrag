import { Server } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

export function IconOpenAI({ className, ...props }: React.ComponentProps<'svg'>) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoType, setLogoType] = useState<string>('chat-bubble');
  const [isLoading, setIsLoading] = useState(true);
  
  // Function to fetch the latest logo settings from API
  const fetchLatestLogo = async () => {
    try {
      // Get logo URL and logo type setting
      const logoResponse = await fetch('/api/config/get-logo?type=ai');
      if (logoResponse.ok) {
        const logoData = await logoResponse.json();
        console.log('[IconOpenAI] Received logo settings:', logoData);
        
        // Handle logo type
        if (logoData.logoType) {
          setLogoType(logoData.logoType);
          localStorage.setItem('AI_LOGO_TYPE', logoData.logoType);
        }
        
        // Handle logo URL
        if (logoData.logoUrl) {
          setLogoUrl(logoData.logoUrl);
          localStorage.setItem('AI_RESPONSE_LOGO_URL', logoData.logoUrl);
        }
        
        // Handle backward compatibility - if useDefaultLogo was true, default to chat-bubble
        if (logoData.useDefaultLogo === true || logoData.useDefaultLogo === 'true') {
          setLogoType('chat-bubble');
          localStorage.setItem('AI_LOGO_TYPE', 'chat-bubble');
        }
      }
    } catch (error) {
      console.error('[IconOpenAI] Error fetching AI logo settings:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    // Initialize from localStorage first (for quick loading)
    const savedLogoUrl = localStorage.getItem('AI_RESPONSE_LOGO_URL');
    const savedLogoType = localStorage.getItem('AI_LOGO_TYPE');
    
    // Set initial values from localStorage
    if (savedLogoType) {
      setLogoType(savedLogoType);
    }
    if (savedLogoUrl) {
      setLogoUrl(savedLogoUrl);
    }
    
    // Fetch the latest settings regardless of localStorage values
    fetchLatestLogo();
    
    // Listen for changes in local storage (for real-time updates)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'AI_LOGO_TYPE' && e.newValue) {
        setLogoType(e.newValue);
      } else if (e.key === 'AI_RESPONSE_LOGO_URL' && e.newValue) {
        setLogoUrl(e.newValue);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for the BroadcastChannel messages
    try {
      const bc = new BroadcastChannel('chatrag-config');
      bc.onmessage = (event) => {
        if (event.data.key === 'AI_LOGO_TYPE') {
          setLogoType(event.data.value);
        } else if (event.data.key === 'AI_RESPONSE_LOGO_URL') {
          setLogoUrl(event.data.value);
        }
      };
      
      return () => {
        bc.close();
        window.removeEventListener('storage', handleStorageChange);
      };
    } catch (err) {
      // BroadcastChannel might not be supported in all browsers
      return () => {
        window.removeEventListener('storage', handleStorageChange);
      };
    }
  }, []);
  
  // If we're still loading, render a placeholder (use chat bubble)
  if (isLoading && !logoUrl) {
    return (
      <Image 
        src="/logos/defaults/chat-bubble.svg"
        alt="AI"
        width={20}
        height={20}
        className={`${className} object-contain brightness-0 saturate-100 dark:brightness-0 dark:invert dark:saturate-100`}
        style={{ backgroundColor: 'transparent' }}
        {...props as any}
      />
    );
  }
  
  // If we have a logo URL (either custom or default), render it as an image
  if (logoUrl) {
    // If it's a data URL (base64 encoded image), use it directly
    if (logoUrl.startsWith('data:')) {
      return (
        <img 
          src={logoUrl}
          alt="AI"
          width={20}
          height={20}
          className={`${className} object-contain brightness-0 saturate-100 dark:brightness-0 dark:invert dark:saturate-100`}
          style={{ 
            backgroundColor: 'transparent',
            objectFit: 'contain'
          }}
          {...props as any}
        />
      );
    }
    
    // Otherwise, for remote URLs use a standard <img> to avoid Next/Image host restrictions in prod
    if (/^https?:\/\//i.test(logoUrl)) {
      return (
        <img
          src={logoUrl}
          alt="AI"
          width={20}
          height={20}
          className={`${className} object-contain brightness-0 saturate-100 dark:brightness-0 dark:invert dark:saturate-100`}
          style={{ backgroundColor: 'transparent', objectFit: 'contain' }}
          {...props as any}
        />
      );
    }
    // For local paths, use Next/Image
    return (
      <Image 
        src={logoUrl}
        alt="AI"
        width={20}
        height={20}
        className={`${className} object-contain brightness-0 saturate-100 dark:brightness-0 dark:invert dark:saturate-100`}
        style={{ backgroundColor: 'transparent' }}
        {...props as any}
      />
    );
  }
  
  // Fallback to chat bubble if nothing else works
  return (
    <Image 
      src="/logos/defaults/chat-bubble.svg"
      alt="AI"
      width={20}
      height={20}
      className={`${className} object-contain brightness-0 saturate-100 dark:brightness-0 dark:invert dark:saturate-100`}
      style={{ backgroundColor: 'transparent' }}
      {...props as any}
    />
  );
}

export function IconUser({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      fill="none"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      className={className}
      {...props}
    >
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
} 