import { useEffect, useState } from "react";
import { PAGES, pageFromHash, type PageDef, type PageKey } from "../lib/router";

/**
 * Hash-based navigation. The terminal is a single static bundle with no
 * server-side routing, so the hash is the whole router — which also means the
 * URL is shareable and the back button works.
 */
export function useRoute(): {
  page: PageDef;
  navigate: (key: PageKey) => void;
} {
  const [page, setPage] = useState<PageDef>(() => pageFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (key: PageKey) => {
    const next = `#/${key}`;
    if (window.location.hash !== next) window.location.hash = next;
    else setPage(pageFromHash(next));
  };

  return { page, navigate };
}

interface Props {
  current: PageDef;
  onNavigate: (key: PageKey) => void;
}

/**
 * The top nav. Function keys mirror a terminal's F-key convention, and the
 * underlying elements are real buttons so keyboard and screen-reader users get
 * the same affordance.
 */
export function Nav({ current, onNavigate }: Props) {
  return (
    <nav className="nav" aria-label="Terminal pages">
      {PAGES.map((p) => {
        const active = p.key === current.key;
        return (
          <button
            key={p.key}
            type="button"
            className={`nav-item${active ? " nav-item-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(p.key)}
          >
            <span className="nav-code">{p.code}</span>
            <span className="nav-label">{p.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
