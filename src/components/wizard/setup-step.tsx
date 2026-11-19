"use client";

import { summarizeColumns } from "@engine/contracts/columns";
import { JobConfigSchema, type JobConfig } from "@engine/contracts/job-config";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { FieldList } from "@/components/fields/field-list";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toDraft, validateDraft, type DraftConfig, type DraftErrors } from "@/lib/draft";
import { errorText, postJson } from "@/lib/fetch-json";
import { ContextPicker } from "./context-picker";
import { SourcePlan } from "./source-plan";
import type { UploadedCsv } from "./upload-step";

type Props = {
  upload: UploadedCsv;
  draft: DraftConfig;
  onChange: (draft: DraftConfig) => void;
  onBack: () => void;
  onNext: (config: JobConfig) => void;
};

export function SetupStep({ upload, draft, onChange, onBack, onNext }: Props) {
  const [errors, setErrors] = useState<DraftErrors>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const set = (patch: Partial<DraftConfig>) => onChange({ ...draft, ...patch });

  const suggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const config = await postJson("/api/suggest", JobConfigSchema, {
        headers: upload.headers,
        sampleRows: upload.rows.slice(0, 5),
        columns: summarizeColumns(upload.headers, upload.rows),
      });
      onChange(toDraft(config));
      setErrors({});
    } catch (err) {
      setSuggestError(errorText(err));
    } finally {
      setSuggesting(false);
    }
  };

  const next = () => {
    const result = validateDraft(draft, upload.headers);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onNext(result.config);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-primary/25 bg-secondary/60 px-4 py-3">
        <SparklesIcon className="size-5 shrink-0 text-primary" aria-hidden />
        <p className="min-w-56 flex-1 text-sm text-secondary-foreground">
          Let Rowsmith read your first rows and propose a setup. You can edit everything it suggests.
        </p>
        <Button type="button" disabled={suggesting} onClick={() => void suggest()}>
          {suggesting ? "Suggesting…" : "Suggest setup"}
        </Button>
        {suggestError && (
          <p role="alert" className="w-full text-sm text-destructive">
            {suggestError}
          </p>
        )}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="rows-heading">
        <h3 id="rows-heading" className="font-semibold">
          Your rows
        </h3>
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <FormField id="key-column" label="Key column" hint="Names each row" error={errors.keyColumn}>
            <Select value={draft.keyColumn} onValueChange={(v) => v && set({ keyColumn: v })}>
              <SelectTrigger id="key-column" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {upload.headers.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="entity" label="What are the rows?" hint="One sentence" error={errors.entityDescription}>
            <Input
              id="entity"
              placeholder="Indian D2C skincare brands"
              value={draft.entityDescription}
              aria-invalid={Boolean(errors.entityDescription) || undefined}
              onChange={(e) => set({ entityDescription: e.target.value })}
            />
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Context columns <span className="font-normal text-muted-foreground">(optional, help tell similar names apart)</span>
          </p>
          <ContextPicker
            headers={upload.headers}
            keyColumn={draft.keyColumn}
            value={draft.contextColumns}
            onChange={(contextColumns) => set({ contextColumns })}
          />
        </div>
      </section>

      <SourcePlan
        headers={upload.headers}
        keyColumn={draft.keyColumn}
        scopeColumn={draft.scopeColumn}
        sites={draft.sites}
        onChange={(patch) => set(patch)}
      />

      <section className="flex flex-col gap-4" aria-labelledby="fields-heading">
        <div>
          <h3 id="fields-heading" className="font-semibold">
            Fields to fill
          </h3>
          <p className="text-sm text-muted-foreground">One column per field. Existing columns only get their blank cells filled.</p>
        </div>
        <FieldList fields={draft.fields} errors={errors} onChange={(fields) => set({ fields })} />
      </section>

      <div className="flex flex-col gap-3 border-t pt-5">
        {errorCount > 0 && (
          <p role="alert" className="text-sm text-destructive">
            Fix {errorCount === 1 ? "the highlighted field" : `the ${errorCount} highlighted fields`} to continue.
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="button" size="lg" className="px-4" onClick={next}>
            Continue to preview
          </Button>
        </div>
      </div>
    </div>
  );
}
