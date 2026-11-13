import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { roleLabel } from "../lib/roles";
import { BrandLockup } from "./BrandMark";
import { cn } from "../lib/cn";

function useDesktopNav() {
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return desktop;
}

export function Sidebar({ workspace, open, onClose }) {
  const desktop = useDesktopNav();
  const { user } = useAuth();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-navy/40 lg:hidden"
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        inert={!desktop && !open}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-deep text-white transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <BrandLockup tone="inverse" subtitle={workspace.title} />
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 lg:hidden"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav aria-label={`${workspace.title} navigation`} className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-medium tracking-[0.12em] text-white/45 uppercase">Workspace</p>
          {workspace.nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-white/10 text-white shadow-[inset_3px_0_0_#168A83]"
                      : "text-white/75 hover:bg-white/5 hover:text-white",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <p className="text-xs font-medium text-white/80">{user ? roleLabel(user.role) : "Not signed in"}</p>
          <p className="mt-1 text-xs leading-5 text-white/55">
            {user
              ? "This browser keeps the session in memory until you sign out or the token expires."
              : "A staff account is required for hospital workspaces."}
          </p>
        </div>
      </aside>
    </>
  );
}
