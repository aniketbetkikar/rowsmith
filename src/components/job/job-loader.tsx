import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { toObjectId } from "@engine/db/client";
import { getJobSummary } from "@engine/db/jobs";
import { rowCells } from "@engine/db/rows";
import { defaultMinutesPerField } from "@/lib/env";
import { jobStatusView } from "@/lib/views";
import { JobView } from "./job-view";

type Props = { params: Promise<{ id: string }> };

/** Server side: resolves the job (404 if unknown), then hands off to polling. */
export async function JobLoader({ params }: Props) {
  const { id } = await params;
  // Job state is live data: stop prerendering here so the DB read (and the
  // driver's internal `new Date()` calls) only ever run at request time.
  await connection();
  const objectId = toObjectId(id);
  const job = objectId ? await getJobSummary(objectId) : null;
  if (!job) notFound();

  return (
    <JobView
      jobId={id}
      initial={jobStatusView(job, await rowCells(job._id))}
      minutesPerField={defaultMinutesPerField()}
    />
  );
}
