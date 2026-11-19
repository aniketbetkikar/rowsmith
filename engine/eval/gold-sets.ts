import { join } from "node:path";
import type { JobConfig } from "@engine/contracts/job-config";
import { GOLD_CONFIG } from "./gold-config";

// Gold sets in different domains, so accuracy fixes are measured beyond one
// kind of sheet. Each set has traps where a wrong value is easy to produce:
//   companies  outdated CEO (Freshworks), HQ ≠ founding country, tickers that
//              must stay null for private companies
//   cities     a well-known non-capital (Sydney), a less-known capital
//              (Wellington), an ambiguous name settled only by context (Springfield)
//   books      posthumous publication (The Trial), serialised before the book
//              (War and Peace), a translated title (The Little Prince)
// Same cell format as gold.csv (see gold-config.ts).

export const CITIES_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Cities around the world",
  contextColumns: ["country", "known_for"],
  fields: [
    {
      name: "is_national_capital",
      type: "boolean",
      description: "Whether the city is the current national capital of its country",
    },
    {
      name: "admin_region",
      type: "text",
      description:
        "Name of the first-level administrative division (state, province or region) the city is in, without words like State, Province or Region",
    },
    {
      name: "iana_time_zone",
      type: "text",
      description: "Canonical IANA time zone identifier for the city, e.g. Europe/Paris",
    },
  ],
};

export const BOOKS_CONFIG: JobConfig = {
  keyColumn: "title",
  entityDescription: "Novels (English titles)",
  contextColumns: ["author"],
  fields: [
    {
      name: "first_published",
      type: "year",
      description:
        "Year the novel was first published as a complete book (not serialisation), in its original language",
    },
    {
      name: "original_language",
      type: "enum",
      description: "Language the novel was originally written in",
      options: ["English", "Spanish", "French", "German", "Russian", "Japanese", "Other"],
    },
    { name: "author_birth_year", type: "year", description: "Year the author was born" },
  ],
};

// Harder sets (facts checked on the web, October 2026). Recent changes, null
// traps and claims that weak sources get wrong:
//   deals     acquisitions closed 2021-2026 (Wiz closed March 2026), a deal
//             that never closed (Adobe-Figma), independents that only acquire
//   licenses  re-licensed back to OSI open source (Redis 8 AGPL in 2025,
//             Elasticsearch AGPL in 2024), source-available ones, and forks
//   towns     travel sites wrongly call Colmar and Rothenburg UNESCO sites;
//             Hoi An moved into Da Nang when Quang Nam merged into it (July 2025)

export const DEALS_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Technology companies",
  contextColumns: ["website"],
  fields: [
    {
      name: "acquired_by",
      type: "text",
      description:
        "Common name of the company or firm that completed an acquisition of this company (e.g. Google, not Alphabet); null if independent or a deal never closed",
    },
    {
      name: "acquisition_year",
      type: "year",
      description: "Year that acquisition was completed (closed, not announced); null if never acquired",
      min: 1990,
    },
    {
      name: "is_public",
      type: "boolean",
      description: "Whether the company's own shares are currently listed on a stock exchange",
    },
  ],
};

export const LICENSES_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Open source and source-available software projects",
  contextColumns: ["homepage"],
  fields: [
    {
      name: "is_osi_open_source",
      type: "boolean",
      description:
        "Whether the latest release of the core project can be used under at least one OSI-approved open source license",
    },
    {
      name: "forked_from",
      type: "text",
      description:
        "Common name of the project this one was forked from, without the vendor (e.g. Vault, not HashiCorp Vault); null if it is not a fork",
    },
  ],
};

export const TOWNS_CONFIG: JobConfig = {
  keyColumn: "name",
  entityDescription: "Small towns and villages popular with tourists",
  contextColumns: ["country"],
  fields: [
    {
      name: "admin_region",
      type: "enum",
      description: "Current first-level administrative division (state, region, province or prefecture) the town is in",
      options: [
        "Upper Austria",
        "South Bohemian Region",
        "Apulia",
        "Gifu",
        "Da Nang",
        "Quang Nam",
        "Bavaria",
        "Grand Est",
        "Alsace",
        "Overijssel",
        "Other",
      ],
    },
    {
      name: "unesco_world_heritage",
      type: "boolean",
      description:
        "Whether the town or its historic centre is part of a property inscribed on the UNESCO World Heritage List",
    },
  ],
};

export type GoldSet = { name: string; config: JobConfig; file: string };

const evalFile = (file: string) => join(process.cwd(), "engine", "eval", file);

export const GOLD_SETS: GoldSet[] = [
  { name: "companies", config: GOLD_CONFIG, file: evalFile("gold.csv") },
  { name: "cities", config: CITIES_CONFIG, file: evalFile("gold-cities.csv") },
  { name: "books", config: BOOKS_CONFIG, file: evalFile("gold-books.csv") },
  { name: "deals", config: DEALS_CONFIG, file: evalFile("gold-deals.csv") },
  { name: "licenses", config: LICENSES_CONFIG, file: evalFile("gold-licenses.csv") },
  { name: "towns", config: TOWNS_CONFIG, file: evalFile("gold-towns.csv") },
];
