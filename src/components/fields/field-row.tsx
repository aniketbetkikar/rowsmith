"use client";

import { XIcon } from "lucide-react";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DraftErrors, DraftField } from "@/lib/draft";
import { FieldRules, type InputProps, type TextKey } from "./field-rules";
import { RolePicker } from "./role-picker";
import { TypeSelect } from "./type-select";

/** Shared by the rows and the list's column header so they line up. */
export const FIELD_GRID = "sm:grid-cols-[minmax(0,12rem)_8.5rem_minmax(0,1fr)_2rem]";

type Props = {
  field: DraftField;
  index: number;
  errors: DraftErrors;
  canRemove: boolean;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
};

export function FieldRow({ field, index, errors, canRemove, onChange, onRemove }: Props) {
  const id = (key: string) => `${field.id}-${key}`;
  const error = (key: string) => errors[`fields.${index}.${key}`];
  const set = (patch: Partial<DraftField>) => onChange({ ...field, ...patch });
  const input = (key: TextKey): InputProps => ({
    id: id(key),
    value: field[key],
    "aria-invalid": Boolean(error(key)) || undefined,
    "aria-describedby": error(key) ? `${id(key)}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [key]: e.target.value }),
  });

  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_7rem_2rem] gap-x-2 gap-y-2 px-3 py-3 sm:items-start sm:gap-x-3 sm:py-2.5 ${FIELD_GRID}`}>
      <FormField id={id("name")} label="Column name" compact error={error("name")}>
        <Input placeholder="founded_year" autoComplete="off" className="font-medium" {...input("name")} />
      </FormField>

      <FormField id={id("type")} label="Type" compact error={error("type")}>
        <TypeSelect id={id("type")} value={field.type} onChange={(type) => set({ type })} />
      </FormField>

      <FormField
        id={id("description")}
        label="What to find"
        compact
        error={error("description")}
        className="max-sm:order-4 max-sm:col-span-3"
      >
        <Input placeholder="Year the company was founded" {...input("description")} />
      </FormField>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="justify-self-end text-muted-foreground hover:text-destructive max-sm:order-3 max-sm:mt-[1.375rem]"
        disabled={!canRemove}
        onClick={onRemove}
        aria-label={`Remove field ${field.name || index + 1}`}
      >
        <XIcon />
      </Button>

      <FieldRules type={field.type} input={input} error={error} />

      <div className="flex flex-col gap-1 max-sm:order-6 max-sm:col-span-3 sm:col-span-2 sm:col-start-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Look it up on</span>
          <Input placeholder="optional, e.g. the company's own site, then a trusted directory" className="h-7 text-xs" {...input("source")} />
        </label>
        <RolePicker value={field.roles} onChange={(roles) => set({ roles })} />
        {error("source") && (
          <p id={`${id("source")}-error`} role="alert" className="text-xs text-destructive">
            {error("source")}
          </p>
        )}
      </div>
    </li>
  );
}
