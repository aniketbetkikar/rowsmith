import { formatUsd } from "@/lib/format";
import { PROOF_RUN, proofRunPerRow, proofRunSaved } from "@/lib/proof-run";
import { formatDuration, formatPerField } from "@/lib/time-saved";
import { cn } from "@/lib/utils";

const STATS = [
  { value: String(PROOF_RUN.filledCells), label: "fields filled" },
  { value: String(PROOF_RUN.blankCells), label: "left blank (not found)" },
  { value: formatUsd(proofRunPerRow()), label: "per row", money: true },
  { value: String(PROOF_RUN.companies), label: "companies completed" },
];

type Props = { minutes: number };

/** One real run, start to finish, under the hero. */
export function ProofStrip({ minutes }: Props) {
  return (
    <section aria-labelledby="proof-heading" className="flex flex-col gap-3 border-y py-5">
      <h2 id="proof-heading" className="text-sm text-muted-foreground">
        From a real run
      </h2>
      <p className="text-sm text-muted-foreground">
        <span className="font-display text-2xl font-bold text-foreground">{proofRunSaved(minutes)}</span> of research,
        done in{" "}
        <span className="font-display text-2xl font-bold text-foreground">
          {formatDuration(PROOF_RUN.seconds * 1000)}
        </span>{" "}
        for <span className="font-display text-2xl font-bold text-brass">{formatUsd(PROOF_RUN.costUsd)}</span>
      </p>
      <ul className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm text-muted-foreground">
        {STATS.map(({ value, label, money }) => (
          <li key={label}>
            <span className={cn("font-display text-xl font-bold", money ? "text-brass" : "text-foreground")}>
              {value}
            </span>{" "}
            {label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Compared with about {formatPerField(minutes)} per field in LLMs: prompting, checking sources and fixing the
        output.
      </p>
    </section>
  );
}
