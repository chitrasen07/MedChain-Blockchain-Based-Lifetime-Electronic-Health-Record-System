import { cn } from "../lib/cn";

const tones = {
  neutral: "border-line bg-canvas text-muted",
  info: "border-teal/20 bg-teal/10 text-teal-dark",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-warning",
  danger: "border-red-200 bg-red-50 text-danger",
};

export function StatusBadge({ tone = "neutral", children, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
