"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Flips the `dark` class set by the layout's inline script and remembers the choice. */
export function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  };

  // Both icons render; CSS shows the right one, so server and client markup match.
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label="Switch light or dark theme">
      <MoonIcon className="dark:hidden" />
      <SunIcon className="hidden dark:block" />
    </Button>
  );
}
