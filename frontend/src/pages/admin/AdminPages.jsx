import { StaffDirectoryScreen } from "../../features/StaffDirectoryScreen";
import { PatientMatchScreen } from "../../features/PatientMatchScreen";
import { ReviewQueueScreen } from "../../features/ReviewQueueScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function AdminOverviewPage() {
  return <WorkspaceScreen pageKey="admin-overview" />;
}
export function AdminRegistrationPage() {
  return <PatientMatchScreen pageKey="admin-registration" canRegister />;
}
export function AdminMatchingPage() {
  return <PatientMatchScreen pageKey="admin-matching" />;
}
export function AdminReviewsPage() {
  return <ReviewQueueScreen pageKey="admin-reviews" />;
}
export function AdminStaffPage() {
  return <StaffDirectoryScreen pageKey="admin-staff" />;
}
