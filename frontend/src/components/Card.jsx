import { cn } from "../lib/cn";

export function Card({ title, description, children, className, flush = false }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(13,33,56,0.04)]", className)}>
      {title || description ? (
        <div className="border-b border-line px-5 py-4">
          {title ? <h2 className="text-[15px] font-semibold tracking-tight text-navy">{title}</h2> : null}
          {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
        </div>
      ) : null}
      <div className={flush ? undefined : "px-5 py-4"}>{children}</div>
    </section>
  );
}
