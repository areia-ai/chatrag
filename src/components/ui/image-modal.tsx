"use client"

import * as React from "react"
import { X, Download } from "lucide-react"
import Image from "next/image"
import { createPortal } from "react-dom"

interface ImageModalProps {
  src: string
  alt: string
  isOpen: boolean
  onClose: () => void
  showDownload?: boolean
}

export function ImageModal({
  src,
  alt,
  isOpen,
  onClose,
  showDownload = true
}: ImageModalProps) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  // Only render portal on client
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent body scroll when modal is open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Also prevent scrolling on html element for iOS
      document.documentElement.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [isOpen]);

  // Handle escape key
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleDownload = async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const filename = alt
        ? `${alt.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`
        : `image_${Date.now()}.png`;

      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading image:', error);
      // Fallback
      const link = document.createElement('a');
      link.href = src;
      link.download = alt || 'image';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent | React.TouchEvent) => {
    // Only close if clicking the backdrop, not the image or buttons
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Use 100dvh for better mobile support (addresses address bar)
        height: '100dvh',
        width: '100vw',
        zIndex: 99999,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none', // Disable browser handling of gestures
        margin: 0,
        padding: 0,
        overscrollBehavior: 'none'
      }}
      onClick={handleBackdropClick}
      onTouchEnd={handleBackdropClick}
    >
      {/* Button container - top right */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          gap: '12px',
          zIndex: 100000,
        }}
      >
        {/* Download button */}
        {showDownload && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDownload();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDownload();
            }}
            disabled={isDownloading}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: 'rgba(50, 50, 50, 0.6)', // Slightly lighter for visibility
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label="Download image"
          >
            {isDownloading ? (
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  border: '2px solid white',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
            ) : (
              <Download style={{ width: '20px', height: '20px', color: 'white' }} />
            )}
          </button>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'rgba(50, 50, 50, 0.6)',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Close"
        >
          <X style={{ width: '24px', height: '24px', color: 'white' }} />
        </button>
      </div>

      {/* Image */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        <Image
          src={src}
          alt={alt}
          width={2048}
          height={2048}
          priority
          unoptimized
          style={{
            maxWidth: '100vw',
            maxHeight: '100dvh',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        />
      </div>

      {/* Keyframe animation for spinner */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  // Use portal to render to body, completely outside React component tree
  return createPortal(modalContent, document.body);
}
