import type { Phase } from "../types";

/**
 * Presentation for each phase.
 *
 * `tone` drives colour and is deliberately coarse (up / down / neutral / none)
 * so colour is never the only signal — the `label` always renders too.
 */
export type PhaseTone = "up" | "down" | "neutral" | "none";

export interface PhasePresentation {
  /** Short uppercase label shown in the table. */
  label: string;
  tone: PhaseTone;
  /** One-line meaning, shown in the detail panel. English. */
  description: string;
}

/**
 * Complete mapping for every non-null phase.
 * Typed as Record<Phase, …> so adding a Phase without a mapping is a type error.
 */
export const PHASE_MAP: Record<Phase, PhasePresentation> = {
  SOS: {
    label: "SOS",
    tone: "up",
    description: "Sign of Strength — price up on aggressive smart-money buying.",
  },
  SPRING: {
    label: "SPRING",
    tone: "up",
    description: "Price drops while smart money accumulates.",
  },
  ABSORB: {
    label: "ABSORB",
    tone: "up",
    description: "Stealth accumulation — smart money active while price stays flat.",
  },
  ACCUM: {
    label: "ACCUM",
    tone: "up",
    description: "Steady accumulation with smart money dominant.",
  },
  UPTHRUST: {
    label: "UPTHRUST",
    tone: "down",
    description: "Trap — price up but big players are distributing.",
  },
  DISTRI: {
    label: "DISTRI",
    tone: "down",
    description: "Active distribution by bad money.",
  },
  NEUTRAL: {
    label: "NEUTRAL",
    tone: "neutral",
    description: "No clear dominance by smart or bad money.",
  },
};

/**
 * Presentation for a missing phase.
 * Deliberately distinct from NEUTRAL so an unanalysed ticker is never read
 * as a neutral signal.
 */
export const NO_PHASE: PhasePresentation = {
  label: "—",
  tone: "none",
  description: "No analytics available for this ticker on this date.",
};

/** Resolve a nullable phase to its presentation. */
export function phasePresentation(phase: Phase | null | undefined): PhasePresentation {
  if (!phase) return NO_PHASE;
  return PHASE_MAP[phase] ?? NO_PHASE;
}

/** CSS class carrying the tone colour. */
export function phaseClass(phase: Phase | null | undefined): string {
  const tone = phasePresentation(phase).tone;
  return `phase phase-${tone}`;
}
