type DashboardRouteSkeletonProps = {
  variant?: "overview" | "site" | "scan";
};

const bar =
  "rounded-full bg-[var(--dashboard-border,#334155)] motion-safe:animate-pulse";
const panel =
  "rounded-3xl border border-[var(--dashboard-border,#334155)] bg-[var(--dashboard-paper,#111827)]";

export function DashboardRouteSkeleton({
  variant = "overview",
}: DashboardRouteSkeletonProps) {
  const isDetail = variant !== "overview";

  return (
    <div
      className="dashboard-home"
      aria-busy="true"
      aria-live="polite"
      data-loading-variant={variant}
    >
      <span className="sr-only">Pagina laden…</span>

      <header className="dashboard-page-heading">
        <div className="w-full max-w-2xl space-y-3">
          {isDetail && <div className={`${bar} h-4 w-28`} />}
          <div className={`${bar} h-9 w-[min(28rem,80%)]`} />
          <div className={`${bar} h-4 w-[min(38rem,95%)]`} />
        </div>
        <div className={`${bar} h-10 w-32`} />
      </header>

      {variant === "scan" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]">
          <section className={`${panel} min-h-96 p-6`}>
            <div className="flex items-center justify-between gap-4">
              <div className={`${bar} h-6 w-44`} />
              <div className={`${bar} h-8 w-20`} />
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div className={`${panel} h-28 p-4`} key={index}>
                  <div className={`${bar} h-4 w-24`} />
                  <div className={`${bar} mt-5 h-7 w-16`} />
                </div>
              ))}
            </div>
          </section>
          <aside className={`${panel} min-h-80 p-6`}>
            <div className={`${bar} h-6 w-36`} />
            <div className={`${bar} mt-8 h-32 w-32 rounded-full`} />
            <div className={`${bar} mt-8 h-4 w-full`} />
            <div className={`${bar} mt-3 h-4 w-4/5`} />
          </aside>
        </div>
      ) : variant === "site" ? (
        <div className="space-y-6">
          <section className={`${panel} grid gap-6 p-6 md:grid-cols-3`}>
            <div className="md:col-span-1">
              <div className={`${bar} h-4 w-28`} />
              <div className={`${bar} mt-5 h-14 w-36`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3 md:col-span-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div className={`${panel} h-24 p-4`} key={index}>
                  <div className={`${bar} h-4 w-20`} />
                  <div className={`${bar} mt-4 h-6 w-16`} />
                </div>
              ))}
            </div>
          </section>
          <section className={`${panel} min-h-72 p-6`}>
            <div className={`${bar} h-6 w-40`} />
            <div className={`${bar} mt-8 h-44 w-full rounded-2xl`} />
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <section className={`${panel} min-h-52 p-6`} key={index}>
              <div className={`${bar} h-6 w-40`} />
              <div className={`${bar} mt-7 h-4 w-full`} />
              <div className={`${bar} mt-3 h-4 w-4/5`} />
              <div className={`${bar} mt-10 h-10 w-32`} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
