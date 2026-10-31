import { describe, it, expect } from "vitest";
import {
  EM_DASH,
  formatInt,
  formatJuta,
  formatPct,
  formatPrice,
  formatRatio,
  directionClass,
  signOf,
} from "../format";

describe("formatJuta", () => {
  it("compacts millions and billions", () => {
    expect(formatJuta(2_450_000)).toBe("2.5B");
    expect(formatJuta(1_234)).toBe("1.2M");
  });

  it("keeps sub-thousand values readable", () => {
    expect(formatJuta(845.3)).toBe("845.3");
    expect(formatJuta(150)).toBe("150.0");
    expect(formatJuta(12.34)).toBe("12.3");
  });

  it("keeps one decimal below the compaction threshold", () => {
    expect(formatJuta(999.9)).toBe("999.9");
    expect(formatJuta(-845.3)).toBe("-845.3");
  });

  it("renders null as an em dash, never zero", () => {
    expect(formatJuta(null)).toBe(EM_DASH);
    expect(formatJuta(undefined)).toBe(EM_DASH);
  });

  it("renders non-finite as an em dash", () => {
    expect(formatJuta(Number.NaN)).toBe(EM_DASH);
    expect(formatJuta(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });

  it("does not render negative zero", () => {
    expect(formatJuta(-0)).toBe("0.0");
  });

  it("keeps negative values signed", () => {
    expect(formatJuta(-1_234)).toBe("-1.2M");
  });
});

describe("formatPct", () => {
  it("adds an explicit sign", () => {
    expect(formatPct(2.314)).toBe("+2.31%");
    expect(formatPct(-0.851)).toBe("-0.85%");
  });

  it("renders true zero without a sign", () => {
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(-0)).toBe("0.00%");
  });

  it("renders null as an em dash", () => {
    expect(formatPct(null)).toBe(EM_DASH);
  });
});

describe("formatInt / formatPrice", () => {
  it("adds thousands separators", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
  });

  it("rounds prices and renders null as dash", () => {
    expect(formatPrice(4975)).toBe("4,975");
    expect(formatPrice(null)).toBe(EM_DASH);
  });
});

describe("formatRatio", () => {
  it("honours decimal places", () => {
    expect(formatRatio(1.2345)).toBe("1.23");
    expect(formatRatio(1.2345, 1)).toBe("1.2");
  });

  it("renders null as dash", () => {
    expect(formatRatio(null)).toBe(EM_DASH);
  });
});

describe("signOf / directionClass", () => {
  it("classifies direction and treats null as flat", () => {
    expect(signOf(5)).toBe(1);
    expect(signOf(-5)).toBe(-1);
    expect(signOf(0)).toBe(0);
    expect(signOf(null)).toBe(0);
  });

  it("maps to css classes", () => {
    expect(directionClass(5)).toBe("val-up");
    expect(directionClass(-5)).toBe("val-down");
    expect(directionClass(null)).toBe("val-flat");
  });
});
