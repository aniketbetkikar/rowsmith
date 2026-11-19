"use client";

import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyField, MAX_FIELDS, type DraftErrors, type DraftField } from "@/lib/draft";
import { FIELD_GRID, FieldRow } from "./field-row";

type Props = {
  fields: DraftField[];
  errors: DraftErrors;
  onChange: (fields: DraftField[]) => void;
};

export function FieldList({ fields, errors, onChange }: Props) {
  const update = (index: number, field: DraftField) =>
    onChange(fields.map((f, i) => (i === index ? field : f)));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border bg-background/40">
        <div
          aria-hidden
          className={`hidden gap-x-3 border-b bg-muted/70 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid ${FIELD_GRID}`}
        >
          <span>Column name</span>
          <span>Type</span>
          <span>What to find</span>
        </div>
        <ul className="divide-y">
          {fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              index={index}
              errors={errors}
              canRemove={fields.length > 1}
              onChange={(next) => update(index, next)}
              onRemove={() => onChange(fields.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      </div>
      {errors.fields && <p className="text-xs text-destructive">{errors.fields}</p>}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={fields.length >= MAX_FIELDS}
          onClick={() => onChange([...fields, emptyField()])}
        >
          <PlusIcon /> Add field
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fields.length} of {MAX_FIELDS}
        </span>
      </div>
    </div>
  );
}
