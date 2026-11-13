import { Link } from "react-router-dom";
import { BrandLockup } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useEffect } from "react";

const roles = [
  {
    name: "Hospital Admin",
    detail: "Patient registration, review cases, and the hospital staff directory.",
  },
  {
    name: "Doctor",
    detail: "Patient lookup and a clinical visit reference. The chart stays off-chain.",
  },
  {
    name: "Receptionist",
    detail: "Patient matching and lookup for a confirmed patient ID.",
  },
  {
    name: "Hospital Staff",
    detail: "Patient lookup and visit references inside one hospital.",
  },
  {
    name: "Reviewer",
    detail: "Review queue and patient matching. Staff accounts stay with the administrator.",
  },
];

export function WelcomePage() {
  useEffect(() => {
    document.title = "MedChain";
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
          <BrandLockup subtitle="Lifetime record references" hideSubtitleOnMobile />
          <nav className="flex items-center justify-end gap-1 sm:gap-5" aria-label="Primary">
            <a href="#access" className="hidden rounded-md px-2 py-2 text-sm font-medium text-ink hover:text-navy sm:inline">
              Access
            </a>
            <a href="#integrity" className="hidden rounded-md px-2 py-2 text-sm font-medium text-ink hover:text-navy md:inline">
              Integrity
            </a>
            <Button to="/login" size="sm" className="shrink-0">
              <span className="sm:hidden">Login</span>
              <span className="hidden sm:inline">Staff login</span>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-20">
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] text-teal uppercase">Lifetime electronic health records</p>
            <h1 className="mt-3 max-w-xl text-[2.125rem] leading-[1.15] font-semibold tracking-tight text-navy sm:text-5xl sm:leading-[1.12]">
              A lifetime medical record reference the hospital can follow.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted">
              MedChain is the staff workspace for identity references, permissions, and hash checks. Clinical charts
              and personal details stay in the hospital system. The blockchain stores the reference, not the chart.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button to="/login" size="lg">
                Staff login
              </Button>
              <a
                href="#access"
                className="inline-flex h-12 min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-5 text-[15px] font-medium text-navy hover:bg-canvas"
              >
                See who can do what
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(13,33,56,0.04)] sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
              <h2 className="text-sm font-semibold tracking-tight text-navy">How a hash check works</h2>
              <span className="hidden text-xs text-muted sm:inline">Diagram only</span>
            </div>
            <ol className="mt-5 space-y-5">
              <li className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-xs font-medium text-navy">1</span>
                <div>
                  <p className="text-sm font-medium text-navy">The chart stays in the hospital system</p>
                  <p className="mt-1 text-sm leading-6 text-muted">Names, diagnoses, and documents are not written to the chain.</p>
                </div>
              </li>
              <li className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-xs font-medium text-navy">2</span>
                <div>
                  <p className="text-sm font-medium text-navy">A hash represents the record</p>
                  <p className="mt-1 text-sm leading-6 text-muted">The chain stores the hash, a record reference, and the time it was registered.</p>
                </div>
              </li>
              <li className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal/10 text-xs font-medium text-teal-dark">3</span>
                <div>
                  <p className="text-sm font-medium text-navy">A mismatch is an integrity failure</p>
                  <p className="mt-1 text-sm leading-6 text-muted">If the current hash differs from the registered hash, the reference no longer matches.</p>
                </div>
              </li>
            </ol>
            <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-muted">
              This panel explains the check. It is not a patient record and it is not connected to a hospital.
            </p>
          </div>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-3">
            <div>
              <p className="text-sm font-semibold tracking-tight text-navy">Off-chain charts</p>
              <p className="mt-1 text-sm leading-6 text-muted">Profiles are encrypted in the hospital database. Lookup returns identifiers, not the chart.</p>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-navy">On-chain references</p>
              <p className="mt-1 text-sm leading-6 text-muted">The registry keeps a patient ID, a DID, a controller wallet, and an optional identity commitment.</p>
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-navy">Hospital boundary</p>
              <p className="mt-1 text-sm leading-6 text-muted">Staff, patients, visits, and reviews stay inside the signed-in hospital.</p>
            </div>
          </div>
        </section>

        <section id="access" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-navy">Role-based access</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              The API assigns one hospital role to each staff account. This page lists those roles. It is not a way to
              sign in as someone else.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {roles.map((role) => (
              <article key={role.name} className="rounded-xl border border-line bg-surface px-5 py-4">
                <h3 className="text-sm font-semibold tracking-tight text-navy">{role.name}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{role.detail}</p>
              </article>
            ))}
            <article className="rounded-xl border border-dashed border-line bg-canvas px-5 py-4 md:col-span-2">
              <h3 className="text-sm font-semibold tracking-tight text-navy">Patient and emergency access</h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Not available. The API has no patient role and no emergency-staff role. Those layouts are marked as
                future work. They are not logins.
              </p>
            </article>
          </div>
        </section>

        <section id="integrity" className="bg-navy-deep text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Integrity and audit</h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-white/72">
                Important actions can be appended to an audit trail. Entries are not edited or deleted. Verification
                compares a submitted hash with the hash already stored for that record reference.
              </p>
            </div>
            <ul className="space-y-3 text-sm leading-6 text-white/80">
              <li className="rounded-lg border border-white/10 px-4 py-3">Patient registration records an identifier, not a diagnosis.</li>
              <li className="rounded-lg border border-white/10 px-4 py-3">Access can be permanent or time-limited, and it ends when the expiry passes.</li>
              <li className="rounded-lg border border-white/10 px-4 py-3">Emergency access, where a contract is used, is temporary and limited to an authorized clinical role.</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
          <div>
            <BrandLockup subtitle="Hospital staff interface" />
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted">
              Identity references, permissions, and hash checks. Clinical charts stay off the chain.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-[0.12em] text-muted uppercase">Staff</p>
            <Link to="/login" className="mt-3 block text-sm font-medium text-teal hover:text-teal-dark">
              Staff login
            </Link>
            <a href="#access" className="mt-2 block text-sm text-ink hover:text-navy">
              Role-based access
            </a>
          </div>
          <div>
            <p className="text-xs font-medium tracking-[0.12em] text-muted uppercase">Not available</p>
            <p className="mt-3 text-sm leading-6 text-muted">Patient sign-in and emergency-staff sign-in are not part of the current API.</p>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">MedChain · Lifetime record references for hospital staff</p>
        </div>
      </footer>
    </div>
  );
}
