import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../lib/cn";

export function Input({
  label,
  hint,
  error,
  id,
  type = "text",
  className,
  ...props
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && visible ? "text" : type;

  return (
    <div className={cn("block", className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "h-11 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-teal focus:ring-2 focus:ring-teal/20",
            isPassword ? "pr-11" : "",
            error ? "border-danger focus:border-danger focus:ring-danger/15" : "border-line",
          )}
          {...props}
        />
        {isPassword ? (
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-navy"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs leading-5 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
