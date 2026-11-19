"use client";

import { FieldTypeSchema, type FieldType } from "@engine/contracts/job-config";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  year: "Year",
  url: "URL",
  enum: "One of…",
  list: "List",
  boolean: "Yes / No",
};

type Props = {
  id?: string;
  value: FieldType;
  onChange: (type: FieldType) => void;
};

export function TypeSelect({ id, value, onChange }: Props) {
  return (
    <Select
      value={value}
      items={LABELS}
      onValueChange={(next) => {
        const parsed = FieldTypeSchema.safeParse(next);
        if (parsed.success) onChange(parsed.data);
      }}
    >
      <SelectTrigger id={id} className="w-full" aria-label="Field type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FieldTypeSchema.options.map((type) => (
          <SelectItem key={type} value={type}>
            {LABELS[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
