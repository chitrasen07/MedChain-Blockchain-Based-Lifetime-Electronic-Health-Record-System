import { EmptyState } from "./EmptyState";
import { LoadingSkeleton } from "./LoadingSkeleton";

export function DataTable({ columns, rows = [], emptyTitle, emptyDescription, loading = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
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
                  <td key={column.key} className="px-4 py-3 text-sm text-ink">
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
