import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { titles: string[]; current: number };

/** The wizard's numbered steps, with a rule that fills as you move through them. */
export function StepList({ titles, current }: Props) {
  return (
    <ol className="flex items-center gap-2 text-sm sm:gap-3" aria-label="Steps">
      {titles.map((title, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={title} aria-current={active ? "step" : undefined} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <span aria-hidden className={cn("h-px w-5 sm:w-10", done || active ? "bg-primary" : "bg-border")} />}
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                active && "bg-primary text-primary-foreground",
                done && "bg-secondary text-secondary-foreground",
                !active && !done && "border text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3.5" aria-label="Done" /> : i + 1}
            </span>
            <span className={cn("font-medium", active ? "text-foreground" : "hidden text-muted-foreground sm:inline")}>
              {title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
