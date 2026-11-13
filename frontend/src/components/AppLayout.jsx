import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ workspace }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(location.pathname);

  if (location.pathname !== menuPath) {
    setMenuPath(location.pathname);
    setOpen(false);
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Sidebar workspace={workspace} open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-64">
        <Topbar title={workspace.title} menuOpen={open} onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
