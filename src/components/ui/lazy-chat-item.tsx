import React, { useRef, useEffect, useState } from 'react';

interface LazyChatItemProps {
  height?: number;
  children: React.ReactNode;
  placeholder?: React.ReactNode;
  rootMargin?: string;
}

export const LazyChatItem = React.memo(({ 
  height = 64,
  children, 
  placeholder,
  rootMargin = '100px'
}: LazyChatItemProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin,
        threshold: 0
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin]);

  return (
    <div 
      ref={elementRef}
      style={{ minHeight: height }}
      className="relative"
    >
      {isVisible ? (
        children
      ) : (
        placeholder || (
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        )
      )}
    </div>
  );
});

LazyChatItem.displayName = 'LazyChatItem';