import { cn } from "../lib/cn";
import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

export function DataTable({ columns, rows = [], emptyTitle, emptyDescription, loading = false, density = "regular" }) {
  const compact = density === "compact";
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", compact ? "" : "min-w-[36rem]")}>
        <thead>
          <tr className={cn("border-b border-line font-medium text-muted uppercase", compact ? "text-[11px] tracking-normal" : "text-[11px] tracking-[0.08em]")}>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn("font-medium", compact ? "px-3 py-2 whitespace-normal" : "px-4 py-3 whitespace-nowrap", column.headerClassName)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-4">
                <LoadingSkeleton rows={4} />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0 hover:bg-canvas">
                {columns.map((column) => (
                  <td key={column.key} className={cn("text-sm text-ink", compact ? "px-3 py-2 align-top" : "px-4 py-3", column.cellClassName)}>
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
