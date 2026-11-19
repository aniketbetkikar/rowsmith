import { ArrowRightIcon, BadgeCheckIcon, GlobeIcon, TimerIcon, type LucideIcon } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { PROOF_RUN, proofRunSaved } from "@/lib/proof-run";
import { formatDuration } from "@/lib/time-saved";

const FEATURES: { icon: LucideIcon; title: string; body: string; mini?: boolean }[] = [
  {
    icon: GlobeIcon,
    title: "Searches the web before answering",
    body: "Every value comes from a live search, with its sources attached.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Validates every value",
    body: "Each answer is checked against the type and rules you set.",
  },
  {
    icon: TimerIcon,
    title: "Shows the time you saved",
    body: "Every job shows the research time it replaced, next to what it cost.",
    mini: true,
  },
];

type Props = { minutes: number };

/** The hero's three promises, set beside the headline. */
export function FeatureList({ minutes }: Props) {
  return (
    <ul className="flex flex-col gap-6 lg:border-l lg:pl-8">
      {FEATURES.map(({ icon: Icon, title, body, mini }) => (
        <li key={title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-primary">
            <Icon className="size-[18px]" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5 pt-1">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-pretty text-muted-foreground">{body}</p>
            {mini && <MiniResult minutes={minutes} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A thumbnail of the results band, using the same measured run as the proof strip. */
function MiniResult({ minutes }: Props) {
  return (
    <p className="mt-2 inline-flex flex-wrap items-center gap-x-1.5 self-start rounded-lg bg-band px-3 py-2 text-sm text-band-foreground">
      <span className="font-display font-bold">{proofRunSaved(minutes)}</span>
      <span className="text-band-muted">of research</span>
      <ArrowRightIcon className="size-3.5 text-band-muted" aria-hidden />
      <span>{formatDuration(PROOF_RUN.seconds * 1000)} for</span>
      <span className="font-semibold text-band-brass">{formatUsd(PROOF_RUN.costUsd)}</span>
    </p>
  );
}
