import { JobSkeleton } from "@/components/job/job-skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-10 pb-20">
      <div className="h-9 w-56 animate-pulse rounded bg-muted" />
      <JobSkeleton />
    </main>
  );
}
