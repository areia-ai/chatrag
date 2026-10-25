"use client"

import React from 'react';
import ReactDOM from 'react-dom';
import { useTheme } from '@/components/theme-provider';

interface TooltipProps {
  content: string;
  position?: 'top' | 'bottom' | 'right';
  show: boolean;
  anchorElement: HTMLElement | null;
}

export function Tooltip({ content, position = 'bottom', show, anchorElement }: TooltipProps) {
  const { theme } = useTheme();
  
  if (!show || !anchorElement) return null;
  
  const rect = anchorElement.getBoundingClientRect();
  const isDarkMode = theme === 'dark';
  
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 99999,
    padding: '0.4rem 0.6rem',
    backgroundColor: isDarkMode ? '#1A1A1A' : '#FF6417',
    color: isDarkMode ? '#E6E6E6' : 'white',
    borderRadius: '0.25rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    pointerEvents: 'none',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    maxWidth: '150px',
    textAlign: 'center',
    whiteSpace: 'nowrap'
  };
  
  if (position === 'top') {
    tooltipStyle.left = `${rect.left + rect.width / 2}px`;
    tooltipStyle.transform = 'translateX(-50%)';
    tooltipStyle.top = rect.top - 40;
  } else if (position === 'right') {
    tooltipStyle.left = rect.right + 4;
    tooltipStyle.top = rect.top + rect.height / 2;
    tooltipStyle.transform = 'translateY(-50%)';
  } else {
    tooltipStyle.left = `${rect.left + rect.width / 2}px`;
    tooltipStyle.transform = 'translateX(-50%)';
    tooltipStyle.top = rect.bottom + 8;
  }
  
  return ReactDOM.createPortal(
    <div style={tooltipStyle}>
      {content}
    </div>,
    document.body
  );
}
