"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { requestWizardReset } from "@/lib/wizard-reset";

type Props = Omit<ComponentProps<typeof Link>, "href">;

/** A link to the home page that also resets the wizard to its first step. */
export function HomeLink({ onClick, ...props }: Props) {
  return (
    <Link
      href="/"
      onClick={(e) => {
        requestWizardReset();
        onClick?.(e);
      }}
      {...props}
    />
  );
}
