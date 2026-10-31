import type { JSX } from "react";

/** A page in the terminal. `wyckoff` is deliberately absent (deferred). */
export type PageKey =
  | "hub"
  | "flow"
  | "stock"
  | "sector"
  | "bsjp"
  | "portfolio"
  | "admin";

export interface PageDef {
  key: PageKey;
  label: string;
  /** Short code shown in the nav, terminal-style. */
  code: string;
  title: string;
  subtitle: string;
}

export const PAGES: readonly PageDef[] = [
  { key: "hub", label: "Hub", code: "F1", title: "Hub", subtitle: "Market snapshot · where to look first" },
  { key: "flow", label: "Flow", code: "F2", title: "Smart / Bad Money", subtitle: "SM · BM · Clean Money · Phase" },
  { key: "stock", label: "Stock", code: "F3", title: "Stock", subtitle: "Chart · Smart/Bad Money · Trade Book" },
  { key: "sector", label: "Sector", code: "F4", title: "Sector Rotation", subtitle: "Rotation map · industry accumulation" },
  { key: "bsjp", label: "BSJP", code: "F5", title: "BSJP Algo", subtitle: "Breakout · sideways · trending · pullback" },
  { key: "portfolio", label: "Portfolio", code: "F6", title: "Portfolio Simulation", subtitle: "Capital growth · equity curve" },
  { key: "admin", label: "Admin", code: "F7", title: "Admin", subtitle: "Data enrichment · algo controls" },
] as const;

const BY_KEY = new Map<string, PageDef>(PAGES.map((p) => [p.key, p]));

/** Resolve the page from a location hash like `#/sector`, `/sector`, or `sector`. */
export function pageFromHash(hash: string): PageDef {
  const cleaned =
    hash
      .replace(/^#/, "")
      .replace(/^\//, "")
      .split("?")[0]
      ?.split("/")[0]
      ?.trim()
      .toLowerCase() ?? "";
  return BY_KEY.get(cleaned) ?? PAGES[0]!;
}

/** The hash a page lives at. */
export function hashFor(page: PageKey): string {
  return `#/${page}`;
}

/** Render-metadata helper so pages stay pure functions of the page key. */
export type PageComponent = () => JSX.Element;
