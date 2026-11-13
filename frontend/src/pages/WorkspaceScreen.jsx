import { useEffect } from "react";
import { ShieldExclamationPoint } from "lucide-react";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { pageChrome } from "../lib/pageChrome";

export function WorkspaceScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  return (
    <div>
      <PageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        crumbs={crumbs}
        actions={page.kind === "pending" ? <StatusBadge tone="warning">Backend integration pending</StatusBadge> : null}
      />

      {page.kind === "pending" ? (
        <Card>
          <div className="flex gap-3">
            <ShieldExclamationPoint className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-navy">{page.pendingTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-muted">{page.pendingMessage}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {page.kind === "overview" ? (
        <section aria-label="Workspace scope">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-navy">Included in this workspace</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {page.items.map((item) => (
              <Card key={item.title} title={item.title}>
                <p className="text-sm leading-6 text-muted">{item.text}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {page.kind === "table" ? (
        <Card flush>
          <DataTable
            columns={page.columns}
            rows={[]}
            emptyTitle={page.emptyTitle}
            emptyDescription={page.emptyDescription}
          />
        </Card>
      ) : null}
    </div>
  );
}
