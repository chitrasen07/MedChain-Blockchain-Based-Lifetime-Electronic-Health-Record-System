import { ClinicalRecordScreen } from "../../features/ClinicalRecordScreen";
import { PatientLookupScreen } from "../../features/PatientLookupScreen";
import { VisitReferenceScreen } from "../../features/VisitReferenceScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function StaffOverviewPage() {
  return <WorkspaceScreen pageKey="staff-overview" />;
}
export function StaffLookupPage() {
  return <PatientLookupScreen pageKey="staff-lookup" />;
}
export function StaffVisitsPage() {
  return <VisitReferenceScreen pageKey="staff-visits" />;
}
export function StaffRecordsPage() {
  return <ClinicalRecordScreen pageKey="staff-records" />;
}
