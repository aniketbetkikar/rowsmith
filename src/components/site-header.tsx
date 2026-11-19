import { HomeLink } from "./home-link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b bg-card/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <HomeLink
          className="font-display text-xl font-bold tracking-[-0.01em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Rowsmith
        </HomeLink>
        <ThemeToggle />
      </div>
    </header>
  );
}
