import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { ApiError, apiClient, messageForRequest } from "../lib/api";
import { MEDICAL_FILE_CATEGORIES, formatFileTime, medicalFileProblem } from "../lib/medicalFiles";

const CATEGORY_LABELS = Object.fromEntries(MEDICAL_FILE_CATEGORIES);

export function MedicalFilesPanel({ patientId, readOnly = false }) {
  const base = readOnly ? "/patient-portal/files" : `/patients/${encodeURIComponent(patientId)}/files`;
  const [files, setFiles] = useState([]);
  const [phase, setPhase] = useState("loading");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("xray");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const previewUrl = useRef("");

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  function replacePreview(next) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = next?.url || "";
    setPreview(next);
  }

  useEffect(() => {
    let active = true;
    apiClient.request(base).then(
      (data) => {
        if (!active) return;
        setFiles(Array.isArray(data?.files) ? data.files : []);
        setPhase("ready");
      },
      (error) => {
        if (!active) return;
        setNotice(error instanceof ApiError ? messageForRequest(error) : "Medical files could not be opened.");
        setPhase("error");
      },
    );
    return () => {
      active = false;
    };
  }, [base]);

  async function onUpload(event) {
    event.preventDefault();
    const file = event.currentTarget.elements.report?.files?.[0];
    const problem = medicalFileProblem(file);
    if (problem) {
      setNotice(problem);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const saved = await apiClient.uploadFile(base, file, { category, description: description.trim() });
      setFiles((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setDescription("");
      event.currentTarget.reset();
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The file was not uploaded.");
    } finally {
      setSaving(false);
    }
  }

  async function openFile(file, intent) {
    setNotice("");
    try {
      const blob = await apiClient.download(`${base}/${encodeURIComponent(file.id)}/content?intent=${intent}`);
      if (intent === "download") {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename || "medical-file";
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
      replacePreview({
        url: URL.createObjectURL(blob),
        contentType: file.contentType,
        filename: file.filename,
      });
    } catch (error) {
      setNotice(error instanceof ApiError ? messageForRequest(error) : "The file could not be opened.");
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Upload a report"
        description="PDF, JPG, and PNG files up to 10 MB. The file is encrypted before it is stored. Upload does not send a wallet transaction."
      >
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={onUpload}>
          <label className="block text-sm font-medium text-ink">
            Category
            <select
              className="mt-1.5 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {MEDICAL_FILE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <Input label="Description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Optional" />
          <label className="block text-sm font-medium text-ink sm:col-span-2">
            File
            <input name="report" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="mt-1.5 block w-full text-sm text-ink" />
          </label>
          <div>
            <Button type="submit" loading={saving} disabled={saving}>Upload file</Button>
          </div>
        </form>
      </Card>
      {notice ? <p role="alert" className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm leading-6 text-ink">{notice}</p> : null}
      <Card title="Medical files" description="Previews and downloads are served through your signed-in session.">
        {phase === "loading" ? <p className="text-sm text-muted">Loading medical files</p> : null}
        {phase === "ready" && files.length === 0 ? <EmptyState title="No medical files" description="Uploaded X-rays, reports, and prescriptions appear here." /> : null}
        {files.map((file) => (
          <article key={file.id} className="mb-4 border-b border-line pb-3 last:mb-0 last:border-0">
            <p className="text-sm font-medium text-navy">{file.filename}</p>
            <p className="mt-1 text-xs text-muted">
              {CATEGORY_LABELS[file.category] || "Medical document"}
              {" · "}
              {file.uploaderLabel || "Uploader unavailable"}
              {file.uploaderRole ? ` · ${file.uploaderRole === "doctor" ? "Doctor" : "Patient"}` : ""}
              {" · "}
              {formatFileTime(file.createdAt)}
            </p>
            {file.description ? <p className="mt-1 text-sm text-ink">{file.description}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => openFile(file, "preview")}>Preview</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => openFile(file, "download")}>Download</Button>
            </div>
          </article>
        ))}
      </Card>
      {preview ? (
        <Card title={preview.filename || "Preview"} description="This preview stays in this browser tab.">
          {preview.contentType === "application/pdf" ? (
            <iframe title={preview.filename || "Medical file preview"} src={preview.url} className="h-[32rem] w-full rounded-lg border border-line" />
          ) : (
            <img src={preview.url} alt={preview.filename || "Medical file preview"} className="max-h-[32rem] max-w-full rounded-lg border border-line" />
          )}
          <Button className="mt-3" type="button" variant="secondary" onClick={() => replacePreview(null)}>Close preview</Button>
        </Card>
      ) : null}
    </div>
  );
}
