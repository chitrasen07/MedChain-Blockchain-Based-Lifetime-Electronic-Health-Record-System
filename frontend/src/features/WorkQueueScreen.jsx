import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { nursingService } from "../services/nursingService";

export function WorkQueueScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [queue, setQueue] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  useEffect(() => {
    let active = true;
    nursingService.queue().then((result) => {
      if (active) setQueue(result);
    }).catch((error) => {
      if (active) setNotice(error instanceof ApiError ? messageForRequest(error) : "The work queue could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      {notice ? <p role="alert" className="mb-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recently registered patients" description="Identifiers only. Open a patient to see the demographic details you are allowed to view.">
          <QueueList loading={loading} items={queue?.recentPatients} empty="No recent registrations are available." render={(item) => (
            <Link className="font-medium text-teal-dark" to={`/staff/lookup?patientId=${encodeURIComponent(item.patientId)}`}>{item.patientId}</Link>
          )} />
        </Card>
        <Card title="Pending laboratory reviews" description="The result text stays encrypted until a doctor opens the review.">
          <QueueList loading={loading} items={queue?.pendingLabs} empty="No laboratory reports are waiting for review." render={(item) => (
            <span>{item.patientId}</span>
          )} />
        </Card>
        <Card title="Visit tasks" description="Pending visit notes for this hospital. The note text is not listed here.">
          <QueueList loading={loading} items={queue?.visitTasks} empty="No visit notes are waiting." render={(item) => (
            <Link className="font-medium text-teal-dark" to={`/staff/lookup?patientId=${encodeURIComponent(item.patientId)}`}>{item.patientId}</Link>
          )} />
        </Card>
        <Card title="Pending vital signs" description="Measurements are omitted from the queue.">
          <QueueList loading={loading} items={queue?.pendingVitals} empty="No vital signs are waiting for review." render={(item) => (
            <span>{item.patientId}</span>
          )} />
        </Card>
      </div>
    </div>
  );
}

function QueueList({ loading, items, empty, render }) {
  if (loading) return <p className="text-sm text-muted">Loading the queue.</p>;
  if (!items?.length) return <EmptyState title="Nothing waiting" description={empty} />;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id || item.patientId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {render(item)}
          <span className="flex items-center gap-2">
            {item.label ? <StatusBadge tone="warning">{item.label}</StatusBadge> : <StatusBadge tone="info">{item.status}</StatusBadge>}
            <span className="text-xs text-muted">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
