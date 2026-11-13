import { useId } from "react";
import { cn } from "../lib/cn";

export function Select({ label, hint, error, id, className, children, ...props }) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={cn("block", className)}>
      {label ? (
        <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-11 w-full rounded-lg border bg-surface px-3 text-sm text-ink focus:border-teal focus:ring-2 focus:ring-teal/20",
          error ? "border-danger focus:border-danger focus:ring-danger/15" : "border-line",
        )}
        {...props}
      >
        {children}
      </select>
      {hint ? <p id={hintId} className="mt-1.5 text-xs leading-5 text-muted">{hint}</p> : null}
      {error ? <p id={errorId} className="mt-1.5 text-xs leading-5 text-danger">{error}</p> : null}
    </div>
  );
}
