'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { SourceImageData } from '@/types/chat';
import { ImageModal } from './image-modal';

interface SourceImagesGridProps {
  images: SourceImageData[];
  className?: string;
}

export const SourceImagesGrid: React.FC<SourceImagesGridProps> = ({
  images,
  className
}) => {
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // Create URLs for images and cleanup on unmount
  useEffect(() => {
    const urls = images.map(img => img.url);
    setImageUrls(urls);

    // Cleanup function to revoke blob URLs when component unmounts
    return () => {
      urls.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [images]);

  // Get grid layout class based on number of images with responsive design
  const getGridClass = useCallback((count: number) => {
    switch (count) {
      case 1:
        return 'grid-cols-1 max-w-[250px] sm:max-w-[280px]'; // Single image - larger for RAG results
      case 2:
        return 'grid-cols-2 max-w-[300px] sm:max-w-[320px]'; // Two images side by side
      case 3:
        return 'grid-cols-3 max-w-[450px] sm:max-w-[480px]'; // Three images in a row
      case 4:
        return 'grid-cols-2 max-w-[300px] sm:max-w-[320px]'; // 2x2 grid
      case 5:
      case 6:
        return 'grid-cols-3 max-w-[450px] sm:max-w-[480px]'; // 3 columns for 5-6 images
      case 7:
      case 8:
      case 9:
        return 'grid-cols-3 max-w-[450px] sm:max-w-[480px]'; // 3 columns for 7-9 images
      default:
        return 'grid-cols-3 sm:grid-cols-4 max-w-[450px] sm:max-w-[640px]'; // Responsive for 10+ images
    }
  }, []);

  // Get image sizing class based on total count and position with responsive design
  const getImageSizeClass = useCallback((count: number, index: number) => {
    // Base sizing for preview images - much larger and more usable with responsive breakpoints
    const baseClass = 'aspect-square';

    if (count === 1) {
      // Single image - large and prominent for RAG source images
      return `${baseClass} w-52 h-52 sm:w-60 sm:h-60`;
    }
    if (count === 2) {
      // Two images - good size for comparison, responsive
      return `${baseClass} w-28 h-28 sm:w-36 sm:h-36`;
    }
    if (count === 3) {
      // Three images - balanced size, mobile-friendly
      return `${baseClass} w-24 h-24 sm:w-32 sm:h-32`;
    }
    if (count === 4) {
      // Four images in 2x2 grid
      return `${baseClass} w-28 h-28 sm:w-32 sm:h-32`;
    }
    if (count <= 6) {
      // 5-6 images - reasonable preview size
      return `${baseClass} w-24 h-24 sm:w-28 sm:h-28`;
    }
    if (count <= 9) {
      // 7-9 images - still readable
      return `${baseClass} w-20 h-20 sm:w-24 sm:h-24`;
    }
    // For 10+ images - smaller but still usable
    return `${baseClass} w-16 h-16 sm:w-20 sm:h-20`;
  }, []);

  const handleImageClick = useCallback((index: number) => {
    setSelectedImageIndex(index);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedImageIndex(null);
  }, []);

  const handlePreviousImage = useCallback(() => {
    if (selectedImageIndex !== null) {
      setSelectedImageIndex((selectedImageIndex - 1 + images.length) % images.length);
    }
  }, [selectedImageIndex, images.length]);

  const handleNextImage = useCallback(() => {
    if (selectedImageIndex !== null) {
      setSelectedImageIndex((selectedImageIndex + 1) % images.length);
    }
  }, [selectedImageIndex, images.length]);

  if (!images.length) {
    return null;
  }

  return (
    <>
      <div className={cn(
        'grid gap-3 my-3 w-fit', // Left-aligned, no mx-auto
        getGridClass(images.length),
        className
      )}>
        {imageUrls.map((url, index) => (
          <div
            key={`source-image-${index}`}
            className={cn(
              'relative overflow-hidden rounded-lg border border-border/50 cursor-pointer group transition-all duration-200 hover:scale-[1.05] hover:shadow-lg hover:border-primary/30',
              getImageSizeClass(images.length, index)
            )}
            onClick={() => handleImageClick(index)}
          >
            <Image
              src={url}
              alt={images[index]?.name || `Source image ${index + 1}`}
              fill
              className="object-cover transition-opacity group-hover:opacity-90 rounded-lg"
              sizes="(max-width: 768px) 50vw, 200px"
              loading="lazy"
              unoptimized
              onError={(e) => {
                console.error('Failed to load image:', url);
                const target = e.currentTarget as HTMLImageElement;
                target.style.backgroundColor = '#f3f4f6';
                target.style.display = 'flex';
                target.style.alignItems = 'center';
                target.style.justifyContent = 'center';
              }}
            />

            {/* Hover overlay with better animation */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-200" />

            {/* Zoom icon on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="bg-black/20 rounded-full p-2 backdrop-blur-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
              </div>
            </div>

            {/* Image count indicator for multiple images */}
            {images.length > 1 && (
              <div className="absolute top-1.5 right-1.5 bg-black/80 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm font-medium">
                {index + 1}/{images.length}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Image Modal */}
      {selectedImageIndex !== null && (
        <ImageModal
          isOpen={true}
          onClose={handleCloseModal}
          src={imageUrls[selectedImageIndex]}
          alt={images[selectedImageIndex]?.name || `Source image ${selectedImageIndex + 1}`}
        />
      )}
    </>
  );
};
