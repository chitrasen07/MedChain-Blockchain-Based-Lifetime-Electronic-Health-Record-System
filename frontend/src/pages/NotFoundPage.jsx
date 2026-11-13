import { useEffect } from "react";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";

export function NotFoundPage() {
  useEffect(() => {
    document.title = "Page not found · MedChain";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface">
        <EmptyState
          heading="h1"
          title="This page is not part of MedChain"
          description="The address does not match a welcome page, staff login, or workspace shell."
          action={
            <Button to="/" variant="secondary">
              Back to welcome
            </Button>
          }
        />
      </div>
    </div>
  );
}
