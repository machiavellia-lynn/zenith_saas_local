import { describe, it, expect } from "vitest";
import { PHASES } from "../../types";
import { PHASE_MAP, NO_PHASE, phasePresentation, phaseClass } from "../phase";

describe("phase mapping", () => {
  it("maps every phase in the closed vocabulary", () => {
    for (const phase of PHASES) {
      expect(PHASE_MAP[phase]).toBeDefined();
      expect(PHASE_MAP[phase].label.length).toBeGreaterThan(0);
      expect(PHASE_MAP[phase].description.length).toBeGreaterThan(0);
    }
  });

  it("has no mapping for a phase that does not exist", () => {
    expect(Object.keys(PHASE_MAP).sort()).toEqual([...PHASES].sort());
  });

  it("tones accumulation phases up and distribution phases down", () => {
    expect(PHASE_MAP.SOS.tone).toBe("up");
    expect(PHASE_MAP.SPRING.tone).toBe("up");
    expect(PHASE_MAP.ABSORB.tone).toBe("up");
    expect(PHASE_MAP.ACCUM.tone).toBe("up");
    expect(PHASE_MAP.UPTHRUST.tone).toBe("down");
    expect(PHASE_MAP.DISTRI.tone).toBe("down");
    expect(PHASE_MAP.NEUTRAL.tone).toBe("neutral");
  });

  it("renders a missing phase distinctly from NEUTRAL", () => {
    expect(phasePresentation(null).tone).toBe("none");
    expect(phasePresentation(undefined).tone).toBe("none");
    expect(NO_PHASE.tone).not.toBe(PHASE_MAP.NEUTRAL.tone);
    expect(NO_PHASE.label).not.toBe(PHASE_MAP.NEUTRAL.label);
  });

  it("exposes a class per tone", () => {
    expect(phaseClass("SOS")).toBe("phase phase-up");
    expect(phaseClass("DISTRI")).toBe("phase phase-down");
    expect(phaseClass("NEUTRAL")).toBe("phase phase-neutral");
    expect(phaseClass(null)).toBe("phase phase-none");
  });
});
