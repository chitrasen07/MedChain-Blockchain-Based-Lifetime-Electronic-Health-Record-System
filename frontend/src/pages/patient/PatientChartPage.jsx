import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingSkeleton } from "../../components/LoadingSkeleton";
import { PageHeader } from "../../components/PageHeader";
import { PatientChart } from "../../features/PatientChart";
import { ApiError, apiClient, messageForRequest } from "../../lib/api";

export function PatientChartPage() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: "loading", data: null, message: "" });

  useEffect(() => {
    document.title = "Health record · MedChain";
  }, []);

  useEffect(() => {
    let active = true;
    apiClient.request("/patient-portal/chart").then(
      (data) => {
        if (active) setState({ phase: "ready", data, message: "" });
      },
      (error) => {
        if (!active) return;
        setState({
          phase: "error",
          data: null,
          message: error instanceof ApiError ? messageForRequest(error) : "The health record could not be opened.",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div>
      <PageHeader
        eyebrow="Patient"
        title="Health record"
        description="Your encrypted chart. Entries are read-only here. Consent changes stay on Access permissions and require your controller wallet."
        crumbs={[{ label: "Patient", to: "/patient" }, { label: "Health record" }]}
      />
      {state.phase === "loading" ? <LoadingSkeleton label="Loading health record" /> : null}
      {state.phase === "error" ? <ErrorState title="Health record unavailable" message={state.message} action={<Button onClick={() => { setState({ phase: "loading", data: null, message: "" }); setAttempt((value) => value + 1); }}>Try again</Button>} /> : null}
      {state.phase === "ready" ? <PatientChart chart={state.data} patientId={state.data.patientId} readOnly /> : null}
    </div>
  );
}
