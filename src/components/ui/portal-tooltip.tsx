'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface PortalTooltipProps {
  content: string;
  children: React.ReactElement;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function PortalTooltip({ content, children, className, align = 'center' }: PortalTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipHeight = 32; // Approximate tooltip height
      const tooltipOffset = 8; // Small offset from button edge
      
      let leftPosition: number;
      
      switch (align) {
        case 'right':
          leftPosition = rect.left;
          break;
        case 'left':
          leftPosition = rect.right - tooltipOffset;
          break;
        default: // 'center'
          leftPosition = rect.left + rect.width / 2;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: leftPosition
      });
    }
  }, [isVisible, align]);

  const clonedChild = React.cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: (e: React.MouseEvent) => {
      setIsVisible(true);
      if (children.props.onMouseEnter) {
        children.props.onMouseEnter(e);
      }
    },
    onMouseLeave: (e: React.MouseEvent) => {
      setIsVisible(false);
      if (children.props.onMouseLeave) {
        children.props.onMouseLeave(e);
      }
    },
  });

  return (
    <>
      {clonedChild}
      {isVisible && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={tooltipRef}
          className={`fixed px-2 py-1 text-xs font-medium text-white dark:text-[#E6E6E6] bg-[#FF6417] dark:bg-[#1A1A1A] rounded-md pointer-events-none whitespace-nowrap ${className || ''}`}
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            transform: align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(0)' : 'translateX(-100%)',
            zIndex: 999999
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}