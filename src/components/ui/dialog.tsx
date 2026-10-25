"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

// Simplified version without the complex context system which caused type errors
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = ({
  ...props
}: DialogPrimitive.DialogPortalProps) => (
  <DialogPrimitive.Portal {...props} />
)
DialogPortal.displayName = DialogPrimitive.Portal.displayName

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/10 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const [mounted, setMounted] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // Track nested portals (like selects, dropdowns)
  const [hasActivePortal, setHasActivePortal] = React.useState(false);
  
  const combinedRef = React.useMemo(() => {
    return (node: HTMLDivElement) => {
      // Update both refs
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
      dialogRef.current = node;
    };
  }, [ref]);

  React.useEffect(() => {
    setMounted(true);
    
    // When dialog opens, add an overflow hidden class to body
    if (document && document.body) {
      document.body.style.overflow = 'hidden';
    }
    
    const handleSelectOpened = () => {
      setHasActivePortal(true);
    };

    const handleSelectClosed = () => {
      // Add a slight delay to avoid immediate state changes
      setTimeout(() => {
        setHasActivePortal(false);
      }, 100);
    };
    
    const handleClickOutside = (e: MouseEvent) => {
      // Don't process clicks if a portal is active (select, dropdown, etc.)
      if (hasActivePortal) return;

      const target = e.target as Node;
      const targetElement = target as HTMLElement;

      // Don't process clicks on portals (dropdowns, selects, etc.)
      if (targetElement.closest('[data-radix-popper-content-wrapper]')) return;

      // Don't process clicks inside any Radix dialog (handles nested dialogs)
      if (targetElement.closest('[data-radix-dialog-content]')) return;
      if (targetElement.closest('[role="dialog"]')) return;

      // Handle clicks outside the dialog
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        // Call the onPointerDownOutside handler if provided
        if (props.onPointerDownOutside) {
          const customEvent = {
            ...e,
            target,
            currentTarget: e.currentTarget,
            preventDefault: () => {}
          };
          props.onPointerDownOutside(customEvent as any);
        }
      }
    };
    
    // Listen for our custom Select events
    document.addEventListener('select-portal-opened', handleSelectOpened);
    document.addEventListener('select-portal-closed', handleSelectClosed);
    document.addEventListener('mousedown', handleClickOutside);
    
    // Cleanup function
    return () => {
      setMounted(false);
      // When dialog closes, restore normal scroll
      if (document && document.body) {
        document.body.style.overflow = '';
      }
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('select-portal-opened', handleSelectOpened);
      document.removeEventListener('select-portal-closed', handleSelectClosed);
    };
  }, [props, hasActivePortal]);

  return (
    <DialogPortal>
      {mounted && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/50 z-50 backdrop-blur-[1px] pointer-events-none"
          aria-hidden="true"
        />
      )}
      <DialogPrimitive.Content
        ref={combinedRef}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        onEscapeKeyDown={(e) => {
          // Don't close if a portal is active
          if (hasActivePortal) {
            e.preventDefault();
            return;
          }
          
          // Ensure escape key works properly
          e.preventDefault();
          if (props.onEscapeKeyDown) {
            props.onEscapeKeyDown(e);
          }
        }}
        onPointerDownOutside={(e) => {
          // Don't close if a portal (like select dropdown) is active
          if (hasActivePortal) {
            e.preventDefault();
            return;
          }

          const target = e.target as HTMLElement;

          // Don't close if clicking on a portal element (dropdowns, selects)
          if (target.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
            return;
          }

          // Don't close if clicking inside a nested dialog
          if (target.closest('[data-radix-dialog-content]')) {
            e.preventDefault();
            return;
          }
          if (target.closest('[role="dialog"]')) {
            e.preventDefault();
            return;
          }

          // Ensure clicking outside closes the dialog
          if (props.onPointerDownOutside) {
            props.onPointerDownOutside(e);
          }
        }}
        onInteractOutside={(e) => {
          // Don't allow outside interactions when portals are active
          if (hasActivePortal) {
            e.preventDefault();
            return;
          }

          const target = e.target as HTMLElement;

          // Don't allow interactions with portal elements outside dialog
          if (target.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
            return;
          }

          // Don't close if interacting inside a nested dialog
          if (target.closest('[data-radix-dialog-content]')) {
            e.preventDefault();
            return;
          }
          if (target.closest('[role="dialog"]')) {
            e.preventDefault();
            return;
          }

          // Handle all interactions outside
          if (props.onInteractOutside) {
            props.onInteractOutside(e);
          }
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} 