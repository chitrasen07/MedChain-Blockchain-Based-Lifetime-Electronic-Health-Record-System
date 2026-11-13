import { PatientLookupScreen } from "../../features/PatientLookupScreen";
import { PatientMatchScreen } from "../../features/PatientMatchScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function ReceptionistOverviewPage() {
  return <WorkspaceScreen pageKey="receptionist-overview" />;
}
export function ReceptionistMatchingPage() {
  return <PatientMatchScreen pageKey="receptionist-matching" />;
}
export function ReceptionistLookupPage() {
  return <PatientLookupScreen pageKey="receptionist-lookup" />;
}
