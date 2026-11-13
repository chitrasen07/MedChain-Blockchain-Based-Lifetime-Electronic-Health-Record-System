import { CircleX } from "lucide-react";

export function ErrorState({ title, message, action, heading = "h2" }) {
  const Heading = heading;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-surface px-6 py-10 text-center">
      <CircleX className="mx-auto h-5 w-5 text-danger" aria-hidden="true" />
      <Heading className="mt-3 text-base font-semibold text-navy">{title}</Heading>
      {message ? <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{message}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
    </div>
  );
}
