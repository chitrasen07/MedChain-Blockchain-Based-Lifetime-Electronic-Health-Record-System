import { Link } from "react-router-dom";

export function PageHeader({ eyebrow, title, description, actions, crumbs }) {
  return (
    <header className="mb-6 border-b border-line pb-5">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {crumbs.map((crumb, index) => {
              const current = index === crumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {crumb.to && !current ? (
                    <Link to={crumb.to} className="hover:text-navy">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={current ? "text-ink" : undefined} aria-current={current ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-medium tracking-[0.14em] text-teal uppercase">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-tight text-navy">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 break-words text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
