import { Inbox } from "lucide-react";

export function EmptyState({ title, description, action, icon: Icon = Inbox, heading = "h2" }) {
  const Heading = heading;
  return (
    <div className="px-4 py-12 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-canvas text-muted">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <Heading className="mt-3 text-sm font-semibold text-navy">{title}</Heading>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
