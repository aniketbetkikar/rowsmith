import { ArrowLeftIcon } from "lucide-react";
import { Suspense } from "react";
import { HomeLink } from "@/components/home-link";
import { JobLoader } from "@/components/job/job-loader";
import { JobSkeleton } from "@/components/job/job-skeleton";

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-10 pb-20">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-[-0.01em] sm:text-3xl">Your results</h1>
        <HomeLink
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:underline"
        >
          <ArrowLeftIcon className="size-4" /> Start a new job
        </HomeLink>
      </header>
      {/* params and the DB read are request-time data: stream them behind Suspense. */}
      <Suspense fallback={<JobSkeleton />}>
        <JobLoader params={params} />
      </Suspense>
    </main>
  );
}
