import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { ApiError, messageForRequest } from "../lib/api";
import { pageChrome } from "../lib/pageChrome";
import { validateVisit, visitService } from "../services/visitService";

export function VisitReferenceScreen({ pageKey }) {
  const { page, crumbs } = pageChrome(pageKey);
  const [form, setForm] = useState({ patientId: "", recordReference: "", recordHash: "" });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = `${page.title} · MedChain`;
  }, [page.title]);

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
    setNotice("");
  }

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = validateVisit(form);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) return;
    setLoading(true);
    setNotice("");
    try {
      const created = await visitService.create(parsed.patientId, parsed.body);
      setResult({ ...created, recordReference: parsed.body.recordReference });
      setForm({ patientId: "", recordReference: "", recordHash: "" });
    } catch (error) {
      setResult(null);
      setNotice(
        error instanceof ApiError && error.status === 404
          ? "No confirmed patient with that ID was found in this hospital."
          : error instanceof ApiError
            ? messageForRequest(error)
            : "The hospital service could not complete the request.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} crumbs={crumbs} />
      <form onSubmit={onSubmit} noValidate>
        <Card title="Visit reference" description="This stores an off-chain reference. It does not submit a medical record to the blockchain.">
          <div className="grid gap-4">
            <Input label="Patient ID" name="patientId" value={form.patientId} error={errors.patientId} onChange={(event) => change("patientId", event.target.value)} />
            <Input label="Record reference" name="recordReference" value={form.recordReference} error={errors.recordReference} onChange={(event) => change("recordReference", event.target.value)} />
            <Input label="Record hash" name="recordHash" value={form.recordHash} error={errors.recordHash} hint="Optional. 0x followed by 64 hexadecimal characters." onChange={(event) => change("recordHash", event.target.value)} />
          </div>
          {notice ? <p role="alert" className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
          <Button className="mt-4" type="submit" loading={loading} disabled={loading}>Save reference</Button>
        </Card>
      </form>
      {result ? (
        <Card className="mt-4" title="Saved reference">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Visit ID</dt>
              <dd className="mt-1 break-all text-ink">{result.visitId}</dd>
            </div>
            <div>
              <dt className="text-muted">Patient ID</dt>
              <dd className="mt-1 break-all text-ink">{result.patientId}</dd>
            </div>
            <div>
              <dt className="text-muted">Record reference</dt>
              <dd className="mt-1 break-all text-ink">{result.recordReference}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
