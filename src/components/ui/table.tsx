import * as React from "react"
import { cn } from "@/lib/utils"
import { useTextSize } from '@/components/providers/text-size-provider';
import { useFont } from '@/components/providers/font-provider';

type TextSize = 'small' | 'default' | 'large';

const textSizeClasses: Record<TextSize, string> = {
  small: 'text-sm',
  default: 'text-base',
  large: 'text-lg'
};

const fontFamilyClasses: Record<string, string> = {
  'inter': 'font-sans',
  'merriweather': 'font-serif',
  'source-code-pro': 'font-mono'
};

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => {
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();

  return (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn(
          "w-full caption-bottom",
          textSizeClasses[textSize],
          fontFamilyClasses[fontFamily],
          className
        )}
        {...props}
      />
    </div>
  );
})
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();

  return (
    <thead 
      ref={ref} 
      className={cn(
        "[&_tr]:border-b",
        textSizeClasses[textSize],
        fontFamilyClasses[fontFamily],
        className
      )} 
      {...props} 
    />
  );
})
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const { textSize } = useTextSize();
  const { fontFamily } = useFont();

  return (
    <tbody
      ref={ref}
      className={cn(
        "[&_tr:last-child]:border-0",
        textSizeClasses[textSize],
        fontFamilyClasses[fontFamily],
        className
      )}
      {...props}
    />
  );
})
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("bg-primary font-medium text-primary-foreground", className)}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const { textSize } = useTextSize();

  return (
    <th
      ref={ref}
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        textSizeClasses[textSize],
        className
      )}
      {...props}
    />
  );
})
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const { textSize } = useTextSize();
  
  return (
    <td
      ref={ref}
      className={cn(
        "p-4 align-middle [&:has([role=checkbox])]:pr-0",
        textSizeClasses[textSize],
        className
      )}
      {...props}
    />
  );
})
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
