/**
 * Enforces the AGENTS.md rule: all colour/spacing/type values come from
 * src/styles/tokens.css, and no component stylesheet hardcodes a hex value.
 *
 * terminal.css is therefore allowed to contain `var(--…)` and nothing that
 * looks like a colour literal.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `import.meta` is declared locally so this file compiles without
 * `@types/node` (the project's tsconfig has no "node" in `types`), and
 * `process.cwd()` is reached through globalThis instead of the Node global.
 * The result still uses node:fs to read the stylesheet from disk.
 */
const importMetaUrl: string = (import.meta as unknown as { url: string }).url;

const processObject = (globalThis as { process?: { cwd?: () => string } }).process;

/** Project root: the first ancestor of this file's directory that has package.json. */
function projectRoot(): string {
  if (typeof processObject?.cwd === "function") return processObject.cwd();

  // file:///D:/zenith_saas_v2/src/styles/__tests__/noHex.test.ts
  const withoutScheme = importMetaUrl.replace(/^file:\/\//, "").replace(/^\/(?=[A-Za-z]:)/, "");
  const segments = decodeURIComponent(withoutScheme).split("/");
  segments.pop(); // file name
  segments.pop(); // __tests__

  while (segments.length > 0) {
    const candidate = segments.join("/");
    if (existsSync(`${candidate}/package.json`)) return candidate;
    segments.pop();
  }
  return "";
}

const stylesheetPath = `${projectRoot()}/src/styles/terminal.css`;

/** A hex colour: #rgb, #rgba, #rrggbb, #rrggbbaa — but not an id selector. */
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;

const STYLESHEET = "terminal.css";

function readStylesheet(): string {
  return readFileSync(stylesheetPath, "utf8");
}

/** Strip comments, then map each selector to its first declaration body. */
function ruleBodies(css: string): Map<string, string> {
  // `[^{}]*` rather than `[^{}]+` so a rule written as `.phase-up\n{` is still
  // captured; comments are stripped so a selector is never keyed with its
  // preceding comment text.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = new Map<string, string>();
  for (const rule of stripped.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim();
    if (!rules.has(selector)) rules.set(selector, (rule[2] ?? "").trim());
  }
  return rules;
}

/** Every declaration body whose selector list mentions `selector`. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies: string[] = [];
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectorList = (rule[1] ?? "").trim();
    if (new RegExp(`(?:^|[,\\s>+~])${escaped}(?![\\w-])`).test(selectorList)) {
      bodies.push((rule[2] ?? "").trim());
    }
  }
  return bodies.join("\n");
}

describe(`terminal.css token rule (AGENTS.md)`, () => {
  it("exists and is non-empty", () => {
    const css = readStylesheet();
    expect(css.trim().length).toBeGreaterThan(0);
  });

  it("contains no raw hex colour literal", () => {
    const css = readStylesheet();

    const offenders: string[] = [];
    css.split(/\r?\n/).forEach((line, index) => {
      const matches = line.match(HEX_COLOUR);
      if (matches) {
        offenders.push(`  line ${index + 1}: ${line.trim()}  ->  ${matches.join(", ")}`);
      }
    });

    expect(
      offenders,
      `Raw hex colour found in src/styles/${STYLESHEET}. ` +
        `Colours must be declared once in src/styles/tokens.css and consumed as var(--token):\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("contains no rgb()/rgba()/hsl()/hsla() colour literal", () => {
    const css = readStylesheet();

    // Only flag literal channel values, not var()-based composition.
    const functional = /\b(?:rgba?|hsla?)\(\s*(?!var\()[^)]*\)/g;

    const offenders: string[] = [];
    css.split(/\r?\n/).forEach((line, index) => {
      const matches = line.match(functional);
      if (matches) {
        offenders.push(`  line ${index + 1}: ${line.trim()}  ->  ${matches.join(", ")}`);
      }
    });

    expect(offenders, `Functional colour literals are not allowed:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("consumes density tokens rather than fixed row/cell geometry", () => {
    const css = readStylesheet();

    // US-013: density must flow through the tokens.
    expect(css).toContain("var(--row-h)");
    expect(css).toContain("var(--cell-py)");
    expect(css).toContain("var(--cell-px)");
  });

  it("keeps the null phase distinct from the neutral phase", () => {
    const rules = ruleBodies(readStylesheet());

    const none = rules.get(".phase-none");
    const neutral = rules.get(".phase-neutral");

    expect(none, ".phase-none missing from terminal.css").toBeDefined();
    expect(neutral, ".phase-neutral missing from terminal.css").toBeDefined();

    // Not merely a different colour: the null chip must carry a border.
    expect(none).toMatch(/border\s*:\s*1px\s+solid\s+var\(--border\)/);
    expect(neutral).not.toMatch(/\bborder\s*:/);
    expect(neutral).toMatch(/background\s*:\s*var\(--flat-dim\)/);
    expect(none).toMatch(/background\s*:\s*transparent/);
  });

  it("keeps the two tape channels distinguishable beyond colour", () => {
    const css = readStylesheet();

    const sm = declarationsFor(css, ".tape-label-sm");
    const bm = declarationsFor(css, ".tape-label-bm");

    expect(sm.length).toBeGreaterThan(0);
    expect(bm.length).toBeGreaterThan(0);

    // Different border style, per US-012.
    expect(sm, ".tape-label-sm must differ from BM by more than colour").toMatch(
      /border-style\s*:\s*solid/,
    );
    expect(bm, ".tape-label-bm must differ from SM by more than colour").toMatch(
      /border-style\s*:\s*dashed/,
    );
  });

  it("styles the addendum classes consumed by the components", () => {
    const rules = ruleBodies(readStylesheet());

    const expected = [
      ".topbar-title",
      ".topbar-meta",
      ".topbar-date",
      ".density-toggle",
      ".btn-active",
      ".tape-tag",
      ".tape-tag-sm",
      ".tape-tag-bm",
    ];

    const missing = expected.filter((selector) => !rules.has(selector));
    expect(missing, `terminal.css is missing: ${missing.join(", ")}`).toEqual([]);

    // The active density button must be a token-driven state, not a third colour.
    expect(rules.get(".btn-active")).toMatch(/background\s*:\s*var\(--accent-dim\)/);
    expect(rules.get(".btn-active")).toMatch(/color\s*:\s*var\(--accent-text\)/);
    expect(rules.get(".btn-active")).toMatch(/border-color\s*:\s*var\(--accent\)/);
  });

  it("gives the tape tags a non-colour channel distinction", () => {
    const css = readStylesheet();
    const sm = declarationsFor(css, ".tape-tag-sm");
    const bm = declarationsFor(css, ".tape-tag-bm");

    // The channels differ by box shape: filled + heavy solid left edge vs
    // unfilled dashed edge. Either is enough on its own; colour is never it.
    const smDistinct = /border-left\s*:\s*3px\s+solid/.test(sm);
    const bmDistinct = /border-style\s*:\s*dashed/.test(bm);

    expect(smDistinct, ".tape-tag-sm must differ from BM by more than colour").toBe(true);
    expect(bmDistinct, ".tape-tag-bm must differ from SM by more than colour").toBe(true);

    // A ::before prefix would duplicate the label the component already renders.
    expect(css).not.toMatch(/\.tape-tag[^{]*::before/);
  });

  it("lets callers size the skeleton, and only pulses it", () => {
    const skel = ruleBodies(readStylesheet()).get(".skeleton");

    expect(skel, ".skeleton missing from terminal.css").toBeDefined();
    expect(skel).toMatch(/background\s*:\s*var\(--surface2\)/);
    expect(skel).toMatch(/border-radius\s*:\s*var\(--radius-sm\)/);
    expect(skel).toMatch(/animation\s*:\s*pulse\s+1\.4s\s+ease-in-out\s+infinite/);

    // Inline width/height are supplied by the caller — never fixed here.
    expect(skel).not.toMatch(/\bwidth\s*:/);
    expect(skel).not.toMatch(/\bheight\s*:/);
    expect(skel).not.toMatch(/\bmin-width\s*:/);
    expect(skel).not.toMatch(/\bmin-height\s*:/);
  });

  it("defines the pulse keyframes from .5 to 1", () => {
    const css = readStylesheet();
    const keyframes = css.slice(css.indexOf("@keyframes pulse"));

    expect(keyframes.length).toBeGreaterThan(0);
    expect(keyframes).toMatch(/opacity\s*:\s*0?\.5/);
    expect(keyframes).toMatch(/opacity\s*:\s*1\b/);
  });
});
