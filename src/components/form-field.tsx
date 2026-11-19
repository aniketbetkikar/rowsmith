import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Hide the label from sm up, where a shared column header names the control. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint/error text, with the error linked for screen readers. */
export function FormField({ id, label, error, hint, compact, className, children }: Props) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={cn(compact && "text-xs text-muted-foreground sm:sr-only")}>
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
