"use client";

import type { JobConfig } from "@engine/contracts/job-config";
import { useState, type ReactNode } from "react";
import { initialDraft, type DraftConfig } from "@/lib/draft";
import { PreviewStep } from "./preview-step";
import { SetupStep } from "./setup-step";
import { StepList } from "./step-list";
import { UploadStep, type UploadedCsv } from "./upload-step";

type Step = "upload" | "setup" | "preview";

const STEPS: { id: Step; title: string; description: string }[] = [
  { id: "upload", title: "Upload", description: "A CSV with one row per entity." },
  { id: "setup", title: "Describe", description: "What the rows are and which fields to fill." },
  { id: "preview", title: "Preview & run", description: "Estimate the cost from a few rows, then run the whole list." },
];

type Props = {
  /** Minutes per field for the preview's time-saved estimate. */
  minutesPerField: number;
  /** Shown above the wizard on the upload step only (the hero). */
  intro?: ReactNode;
};

export function WizardFlow({ minutesPerField, intro }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [upload, setUpload] = useState<UploadedCsv | null>(null);
  const [draft, setDraft] = useState<DraftConfig | null>(null);
  const [config, setConfig] = useState<JobConfig | null>(null);

  const current = STEPS.findIndex((s) => s.id === step);
  const active = STEPS[current] ?? STEPS[0]!;

  const onUpload = (next: UploadedCsv) => {
    setUpload(next);
    // A new file can have different columns: start the setup fresh.
    setDraft(initialDraft(next.headers));
    setConfig(null);
  };

  const goTo = (next: Step) => {
    setStep(next);
    // The intro disappears after the first step: bring the wizard into view.
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      {step === "upload" && intro}
      <section className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_var(--border)]">
        <header className="flex flex-col gap-4 border-b px-5 py-5 sm:px-8">
          <StepList titles={STEPS.map((s) => s.title)} current={current} />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{active.title}</h2>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </div>
        </header>
        <div className="px-5 py-6 sm:px-8">
          {step === "upload" && <UploadStep value={upload} onChange={onUpload} onNext={() => goTo("setup")} />}
          {step === "setup" && upload && draft && (
            <SetupStep
              upload={upload}
              draft={draft}
              onChange={setDraft}
              onBack={() => goTo("upload")}
              onNext={(next) => {
                setConfig(next);
                goTo("preview");
              }}
            />
          )}
          {step === "preview" && upload && config && (
            <PreviewStep upload={upload} config={config} onBack={() => goTo("setup")} minutesPerField={minutesPerField} />
          )}
        </div>
      </section>
    </>
  );
}
