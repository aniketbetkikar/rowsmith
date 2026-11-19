/** Placeholder while the job loads (static shell + loading.tsx). */
export function JobSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading job">
      <div className="h-44 w-full rounded-xl bg-band/80" />
      <div className="h-64 w-full rounded-xl bg-muted" />
    </div>
  );
}
