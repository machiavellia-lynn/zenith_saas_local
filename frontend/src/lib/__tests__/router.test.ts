import { describe, it, expect } from "vitest";
import { PAGES, pageFromHash, hashFor } from "../router";

describe("router", () => {
  it("defines every delivered page except wyckoff", () => {
    const keys = PAGES.map((p) => p.key);
    expect(keys).toContain("hub");
    expect(keys).toContain("flow");
    expect(keys).toContain("stock");
    expect(keys).toContain("sector");
    expect(keys).toContain("bsjp");
    expect(keys).toContain("portfolio");
    expect(keys).toContain("admin");
    // The owner deferred this page explicitly.
    expect(keys).not.toContain("wyckoff");
  });

  it("gives every page a unique key and code", () => {
    const keys = PAGES.map((p) => p.key);
    const codes = PAGES.map((p) => p.code);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("resolves a hash to a page", () => {
    expect(pageFromHash("#/sector").key).toBe("sector");
    expect(pageFromHash("#/flow").key).toBe("flow");
    expect(pageFromHash("/admin").key).toBe("admin");
  });

  it("falls back to the hub for an unknown or empty hash", () => {
    expect(pageFromHash("").key).toBe("hub");
    expect(pageFromHash("#/nope").key).toBe("hub");
    expect(pageFromHash("#/wyckoff").key).toBe("hub");
  });

  it("round-trips through hashFor", () => {
    for (const p of PAGES) {
      expect(pageFromHash(hashFor(p.key)).key).toBe(p.key);
    }
  });

  it("ignores a query string on the hash", () => {
    expect(pageFromHash("#/stock?ticker=BBRI").key).toBe("stock");
  });
});
