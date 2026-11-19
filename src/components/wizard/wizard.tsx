"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { resetToken, subscribeReset } from "@/lib/wizard-reset";
import { WizardFlow } from "./wizard-flow";

/**
 * The upload → setup → preview flow. Keyed on the reset token so the home
 * links ("Rowsmith", "Start a new job") always bring back a fresh form.
 */
export function Wizard(props: ComponentProps<typeof WizardFlow>) {
  const token = useSyncExternalStore(subscribeReset, resetToken, () => 0);
  return <WizardFlow key={token} {...props} />;
}
