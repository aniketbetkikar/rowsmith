"use client";

import { ROW_CAPS } from "@engine/contracts/job-status";
import type { JobConfig } from "@engine/contracts/job-config";
import { useRouter } from "next/navigation";
import { CalculatorIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { FormField } from "@/components/form-field";
import { JobView } from "@/components/job/job-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateJobResponseSchema, type CreateJobBody, type JobStatusResponse } from "@/lib/api";
import { errorText, postJson } from "@/lib/fetch-json";
import { previewCostPerRow } from "@/components/job/cost-estimate";
import type { UploadedCsv } from "./upload-step";

const EmailSchema = z.email("Enter a valid email address.");

type Props = {
  upload: UploadedCsv;
  config: JobConfig;
  onBack: () => void;
  /** Minutes per field for the preview's time-saved estimate. */
  minutesPerField: number;
};

export function PreviewStep({ upload, config, onBack, minutesPerField }: Props) {
  const router = useRouter();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<JobStatusResponse | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"preview" | "full" | null>(null);
  const [error, setError] = useState<{ step: "preview" | "full"; message: string } | null>(null);

  const fullRows = Math.min(upload.rows.length, ROW_CAPS.full);
  const previewRows = Math.min(upload.rows.length, ROW_CAPS.preview);
  // The full run unlocks once the preview has finished and given a cost per row.
  const estimated = preview?.status === "completed" && previewCostPerRow(preview) !== null;
  const previewFailed = preview?.status === "failed";

  const create = async (body: CreateJobBody) => {
    setBusy(body.mode);
    setError(null);
    try {
      return (await postJson("/api/jobs", CreateJobResponseSchema, body)).jobId;
    } catch (err) {
      setError({ step: body.mode, message: errorText(err) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async () => {
    const jobId = await create({ csv: upload.csv, config, mode: "preview" });
    if (jobId) {
      setPreview(null);
      setPreviewId(jobId);
    }
  };

  const runFull = async () => {
    // Optional: checked only when filled in.
    const trimmed = email.trim();
    const parsed = trimmed ? EmailSchema.safeParse(trimmed) : null;
    if (parsed && !parsed.success) {
      setError({ step: "full", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." });
      return;
    }
    const jobId = await create({
      csv: upload.csv,
      config,
      mode: "full",
      email: parsed?.data,
      // its rows are reused instead of researched again
      previewJobId: previewId ?? undefined,
    });
    if (jobId) router.push(`/jobs/${jobId}`);
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="preview-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="preview-heading" className="font-semibold">
              Estimate the total cost from {previewRows} rows
            </h3>
            <p className="text-sm text-muted-foreground">
              Fills the first {previewRows} rows so you can check the answers, then estimates the cost of all {fullRows}.
            </p>
          </div>
          {(!previewId || previewFailed) && (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runPreview()}>
              <CalculatorIcon /> {busy === "preview" ? "Starting…" : previewFailed ? "Try again" : "Estimate cost"}
            </Button>
          )}
        </div>
        {error?.step === "preview" && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        {previewId && (
          <JobView
            key={previewId}
            jobId={previewId}
            showDownload={false}
            minutesPerField={minutesPerField}
            onData={setPreview}
            estimateRows={fullRows}
          />
        )}
      </section>

      <section
        className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-secondary/60 p-4 sm:p-5"
        aria-labelledby="full-heading"
      >
        <div>
          <h3 id="full-heading" className="font-semibold">
            Run the full job
          </h3>
          <p className="text-sm text-secondary-foreground/80">
            {upload.rows.length > ROW_CAPS.full
              ? `The free demo processes the first ${ROW_CAPS.full} of your ${upload.rows.length} rows.`
              : `Processes all ${fullRows} rows.`}{" "}
            Email is optional and is only saved with the job.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <FormField id="email" label="Email (optional)" className="sm:w-80" error={error?.step === "full" ? error.message : undefined}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className="h-9 bg-card"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <Button
            type="button"
            size="lg"
            className="px-4 sm:mt-5"
            disabled={busy !== null || !estimated}
            onClick={() => void runFull()}
          >
            {busy === "full" ? "Starting…" : `Run on ${fullRows} rows`}
          </Button>
        </div>
        {!estimated && (
          <p className="text-xs text-secondary-foreground/80">
            {previewId ? "Available once the estimate is ready." : "Get the cost estimate above first."}
          </p>
        )}
      </section>

      <div className="border-t pt-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to setup
        </Button>
      </div>
    </div>
  );
}
