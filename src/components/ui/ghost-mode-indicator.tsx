'use client';

import { Ghost } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/components/providers/language-provider';

interface GhostModeIndicatorProps {
  isActive: boolean;
  className?: string;
}

export function GhostModeIndicator({ isActive, className }: GhostModeIndicatorProps) {
  const { t } = useLanguage();

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "flex items-center justify-center gap-2",
            "px-3 sm:px-4 py-2 rounded-lg",
            "bg-purple-500/20 dark:bg-purple-600/20",
            "border border-purple-500/30 dark:border-purple-600/30",
            "backdrop-blur-3xl",
            "mx-auto max-w-fit",
            className
          )}
        >
          <Ghost className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-medium text-purple-700 dark:text-purple-300 text-center">
            {t('incognitoChatActiveMessage')}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}