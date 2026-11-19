import type { Metadata } from "next";
import { Archivo, Schibsted_Grotesk } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteUrl } from "@/lib/env";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Display face: the wordmark, page headings and cost figures.
const schibsted = Schibsted_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

// Runs before first paint: the saved theme, else the system setting.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`;

const DESCRIPTION =
  "Upload a list, describe the fields you need, and get every row filled in with verified, sourced data.";
const OG_IMAGE = { url: "/images/rowsmith-og.png", width: 1200, height: 630, alt: "Rowsmith" };

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Rowsmith",
  description: DESCRIPTION,
  applicationName: "Rowsmith",
  icons: {
    icon: [
      { url: "/images/favicon.ico", sizes: "any" },
      { url: "/images/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/images/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  manifest: "/images/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Rowsmith",
    title: "Rowsmith",
    description: DESCRIPTION,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rowsmith",
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${schibsted.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <SiteHeader />
          {children}
          <footer className="py-6 text-center text-xs text-muted-foreground">Built by Aniket Betkikar</footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
