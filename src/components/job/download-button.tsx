import { DownloadIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { jobId: string; ready: boolean };

// Light on the dark results band, in both themes.
const ON_BAND = "h-9 px-3.5 bg-band-foreground text-band hover:bg-band-foreground/85 disabled:opacity-40";

/** Plain link to the CSV route, so the browser handles the download. */
export function DownloadButton({ jobId, ready }: Props) {
  if (!ready) {
    return (
      <Button disabled className={ON_BAND}>
        <DownloadIcon /> Download CSV
      </Button>
    );
  }
  return (
    <a href={`/api/jobs/${jobId}/download`} download className={cn(buttonVariants(), ON_BAND)}>
      <DownloadIcon /> Download CSV
    </a>
  );
}
