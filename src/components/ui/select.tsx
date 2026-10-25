"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

// Track active state with a singleton pattern
const selectState = {
  activeCount: 0,
  increment() { this.activeCount++ },
  decrement() { this.activeCount = Math.max(0, this.activeCount - 1) },
  isActive() { return this.activeCount > 0 }
}

// Custom event to notify when a select dropdown is open/closed
export const emitSelectPortalEvent = (open: boolean) => {
  const eventName = open ? 'select-portal-opened' : 'select-portal-closed';
  try {
    document.dispatchEvent(new CustomEvent(eventName));
  } catch (e) {
    console.error(`Failed to emit ${eventName}`, e);
  }
}

// Use the original Root component
const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, onClick, ...props }, ref) => {
  // Wrap the click handler to stop propagation
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent event from bubbling up to parent components
    e.stopPropagation();
    
    // Call the original onClick if provided
    if (onClick) {
      onClick(e);
    }
  }, [onClick]);

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

  const SelectContent = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
  >(({ className, children, position = "popper", ...props }, ref) => {
    // When the content is first rendered, emit an open event and track state
    React.useEffect(() => {
      selectState.increment();
      emitSelectPortalEvent(true);
      
      // Clean up when unmounted (select is closed)
      return () => {
        selectState.decrement();
        emitSelectPortalEvent(false);
      };
    }, []);

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-[9999] min-w-[8rem] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          style={{ 
            border: 'none',
            outline: 'none',
            ...props.style
          }}
          position={position}
          // Stop event propagation on all interactions
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          {...props}
        >
          <SelectPrimitive.Viewport
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

  const SelectItem = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
  >(({ className, children, onClick, ...props }, ref) => {
    // Handle click events to stop propagation
    const handleClick = React.useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      
      // Call the original handler if provided
      if (onClick) {
        onClick(e as any);
      }
    }, [onClick]);

    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2.5 pl-10 pr-4 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 my-0.5 transition-colors",
          className
        )}
        style={{ 
          ...props.style
        }}
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        {...props}
      >
        <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check className="h-4 w-4 text-[#FF6417] dark:text-[#FF8A4D]" />
          </SelectPrimitive.ItemIndicator>
        </span>

        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      </SelectPrimitive.Item>
    )
  })
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

// Export a function to check if any select is active
export function isAnySelectActive() {
  return selectState.isActive();
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} 