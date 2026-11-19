"use client";

import type { FieldType } from "@engine/contracts/job-config";
import { Input } from "@/components/ui/input";
import type { DraftField } from "@/lib/draft";
import { cn } from "@/lib/utils";

/** The draft field's text inputs. */
export type TextKey = { [K in keyof DraftField]: DraftField[K] extends string ? K : never }[keyof DraftField];

export type InputProps = {
  id: string;
  value: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

type Props = {
  type: FieldType;
  input: (key: TextKey) => InputProps;
  error: (key: string) => string | undefined;
};

/** One compact line of type-specific rules, tucked under the field it belongs to. */
export function FieldRules({ type, input, error }: Props) {
  const keys: TextKey[] =
    type === "enum" ? ["options"] : type === "number" || type === "year" ? ["min", "max"] : type === "list" ? ["maxItems"] : [];
  if (keys.length === 0) return null;
  const errors = keys.flatMap((key) => {
    const message = error(key);
    return message ? [{ id: `${input(key).id}-error`, message }] : [];
  });

  return (
    <div className="flex flex-col gap-1 max-sm:order-5 max-sm:col-span-3 sm:col-span-2 sm:col-start-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md bg-muted/70 py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        {type === "enum" && (
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">Allowed values</span>
            <Input placeholder="SaaS, Fintech, Other" className={rule("min-w-40 flex-1")} {...input("options")} />
          </label>
        )}
        {(type === "number" || type === "year") && (
          <>
            <label className="flex items-center gap-2">
              <span>Between</span>
              <Input inputMode="decimal" placeholder="any" aria-label="Minimum (optional)" className={rule("w-24")} {...input("min")} />
            </label>
            <label className="flex items-center gap-2">
              <span>and</span>
              <Input inputMode="decimal" placeholder="any" aria-label="Maximum (optional)" className={rule("w-24")} {...input("max")} />
            </label>
          </>
        )}
        {type === "list" && (
          <label className="flex items-center gap-2">
            <span>Up to</span>
            <Input inputMode="numeric" placeholder="5" aria-label="Max items, 1 to 10 (optional)" className={rule("w-16")} {...input("maxItems")} />
            <span>items (1–10)</span>
          </label>
        )}
      </div>
      {errors.map((e) => (
        <p key={e.id} id={e.id} role="alert" className="text-xs text-destructive">
          {e.message}
        </p>
      ))}
    </div>
  );
}

const rule = (className: string) => cn("h-7 bg-card text-xs", className);
