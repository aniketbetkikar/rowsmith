import { FeatureList } from "@/components/feature-list";
import { ProofStrip } from "@/components/proof-strip";
import { Wizard } from "@/components/wizard/wizard";
import { defaultMinutesPerField } from "@/lib/env";

export default function HomePage() {
  const minutes = defaultMinutesPerField();
  // The hero shows on the upload step only; later steps keep just the form.
  const intro = (
    <>
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
        <header className="flex flex-col gap-4">
          <h1 className="font-display text-3xl leading-[1.1] font-bold tracking-[-0.015em] text-balance sm:text-5xl">
            Hours of list research, done in minutes,{" "}
            {/* Marker stroke across the lower half; brass because it's about money. */}
            <span className="box-decoration-clone bg-[linear-gradient(transparent_52%,var(--highlight)_52%,var(--highlight)_92%,transparent_92%)] px-1">
              for a few dollars.
            </span>
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Upload a CSV, describe the columns you need, and Rowsmith researches every row on the web, with sources and
            a validated value for each cell.
          </p>
        </header>
        <FeatureList minutes={minutes} />
      </div>
      <ProofStrip minutes={minutes} />
    </>
  );
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-10 pb-20 sm:gap-10 sm:pt-14">
      <Wizard minutesPerField={minutes} intro={intro} />
    </main>
  );
}
