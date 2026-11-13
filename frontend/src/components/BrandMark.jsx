import { cn } from "../lib/cn";

export function BrandMark({ tone = "navy", className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md",
        tone === "inverse" ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-navy text-white",
        className,
      )}
    >
      <span className="flex w-4 flex-col gap-1">
        <span className="h-0.5 w-full rounded-full bg-teal" />
        <span className="h-0.5 w-3/4 rounded-full bg-current" />
        <span className="h-0.5 w-1/2 rounded-full bg-current opacity-60" />
      </span>
    </span>
  );
}

export function BrandLockup({ tone = "navy", subtitle, hideSubtitleOnMobile = false }) {
  const light = tone === "inverse";
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <BrandMark tone={tone} className="shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className={cn("block truncate text-sm font-semibold tracking-tight", light ? "text-white" : "text-navy")}>
          MedChain
        </span>
        {subtitle ? (
          <span
            className={cn(
              "block truncate text-xs",
              light ? "text-white/70" : "text-muted",
              hideSubtitleOnMobile ? "hidden sm:block" : "",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
