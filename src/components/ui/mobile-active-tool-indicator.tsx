'use client';

import React from 'react';
import { X, Globe, Palette, Video, Box, Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface MobileActiveToolIndicatorProps {
  isVisible: boolean;
  toolType: 'web-search' | 'image-generation' | 'video-generation' | '3d-generation' | 'mcp-tools' | null;
  onCancel: () => void;
  className?: string;
}

// Tool configuration with EXACT same icons as desktop
const TOOL_CONFIG = {
  'web-search': {
    icon: Globe,
    color: 'text-blue-500',
  },
  'image-generation': {
    icon: Palette,
    color: 'text-yellow-500',
  },
  'video-generation': {
    icon: Video,
    color: 'text-orange-600',
  },
  '3d-generation': {
    icon: Box,
    color: 'text-red-500',
  },
  'mcp-tools': {
    icon: Hammer,
    color: 'text-purple-500',
  },
} as const;

export function MobileActiveToolIndicator({
  isVisible,
  toolType,
  onCancel,
  className
}: MobileActiveToolIndicatorProps) {
  const config = toolType ? TOOL_CONFIG[toolType] : null;
  const IconComponent = config?.icon;
  const shouldShow = isVisible && toolType && config;

  return (
    <AnimatePresence mode="wait">
      {shouldShow && IconComponent && (
        <motion.div
          key={toolType}
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: 'auto' }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.15, ease: 'easeInOut' }}
          className={cn(
            "overflow-hidden",
            className
          )}
        >
          <div
            className={cn(
              "group flex items-center gap-1.5 h-9 pl-2 pr-1.5 rounded-xl transition-colors",
              "hover:bg-gray-800/70 dark:hover:bg-gray-700/70"
            )}
          >
            {/* Tool Icon */}
            <div className="antialiased">
              <IconComponent className={cn("w-[21px] h-[21px]", config.color)} strokeWidth={1.5} />
            </div>

            {/* Cancel Button */}
            <button
              onClick={onCancel}
              className={cn(
                "flex items-center justify-center",
                "focus:outline-none"
              )}
              aria-label="Cancel active tool"
            >
              <X className="w-4 h-4 text-gray-400 dark:text-gray-400" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
} 