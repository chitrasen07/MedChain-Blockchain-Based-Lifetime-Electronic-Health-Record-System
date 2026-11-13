export function LoadingSkeleton({ rows = 3, label = "Loading" }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-lg bg-line" style={{ width: `${100 - (index % 3) * 12}%` }} />
      ))}
    </div>
  );
}
