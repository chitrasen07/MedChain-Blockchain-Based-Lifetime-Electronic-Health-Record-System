import { PatientMatchScreen } from "../../features/PatientMatchScreen";
import { ReviewQueueScreen } from "../../features/ReviewQueueScreen";
import { WorkspaceScreen } from "../WorkspaceScreen";

export function ReviewerOverviewPage() {
  return <WorkspaceScreen pageKey="reviewer-overview" />;
}
export function ReviewerQueuePage() {
  return <ReviewQueueScreen pageKey="reviewer-queue" />;
}
export function ReviewerMatchingPage() {
  return <PatientMatchScreen pageKey="reviewer-matching" />;
}
