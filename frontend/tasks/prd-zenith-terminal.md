# PRD: Zenith Terminal — Smart/Bad Money Dashboard (Frontend Redesign)

**Status:** Draft for review
**Project root:** `D:\zenith_saas_v2` (new, standalone)
**Reference (READ-ONLY):** `D:\zenith_saas` — existing Flask + Jinja app. Must not be modified.

---

## Introduction

The current Zenith frontend is spread across 11 Jinja templates (some 66–79 KB) sharing
three ad-hoc CSS files. It is hard to extend, and the visual language it uses no longer
matches what the dashboard is for: it is a dense, numeric, glanceable trading surface
being rendered with a soft consumer-SaaS aesthetic.

This PRD specifies a **standalone frontend** — a Bloomberg-terminal-style Smart/Bad Money
dashboard — built as a new Vite + React + TypeScript project, running on **static mock
data only**. No backend calls, no Flask wiring.

### What this document is grounded in (verified, not assumed)

Read from `D:\zenith_saas` during authoring:

| Fact | Source | Consequence |
|---|---|---|
| Existing design system is **light-mode default**, clay/terracotta accent, "Calm Linear" | `static/tokens.css` (398 lines) | **Deliberately replaced.** Dark terminal is the chosen direction. |
| Its own comment states "nothing here is meant to be looked at for eight hours and hurt" | `static/tokens.css` L70-71 | Direct conflict with a terminal aesthetic — resolved by owner decision (see Open Questions Q1). |
| The flow API returns a **fixed, known JSON shape** | `routes/routes_flow.py` L234-286 | Mock data must imitate this exactly, so swapping to the real API is a base-URL change. |
| Phases are a **closed vocabulary**: `SOS`, `UPTHRUST`, `ABSORB`, `SPRING`, `DISTRI`, `ACCUM`, `NEUTRAL` | `algo/algo_wyckoff.py` L53-83 | The UI must not invent phases. Colour/mapping tables derive from this list. |
| `clean_money` = SM − BM, and the table **sorts by it descending** | `routes_flow.py` L269 | Default sort order is not a design choice; it matches the backend. |
| Values are in **Juta** (millions of IDR) | `routes_flow.py` L240-284 | Formatting must be compact (`1.2M`/`1.2B`), or the table is unreadable. |
| `phase` and `action` can be absent for tickers with no analytics | `routes_flow.py` L230-233 | Empty-state handling is required, not optional. |
| `/api/transactions` returns `sm` and `bm` arrays split by channel | `routes_flow.py` L321-336 | The detail panel's transaction tape has a real shape to imitate. |

Authentication returns `401 {"error": "unauthorized"}` on every endpoint
(`routes_flow.py` L33) — irrelevant here, since there is no backend, but it confirms the
real API is gated and mock data must not pretend otherwise.

### The prerequisite check

This feature is **greenfield frontend with no prerequisite** — which is why it is a good
candidate for a standalone build. It does not need the Flask app running, the Postgres
database, or any credential. The only external dependency is Node.

---

## Goals

1. A single-page terminal dashboard renders a sortable table of IDX tickers with
   Smart Money / Bad Money / Clean Money metrics, at a density a trader can scan.
2. Every value comes from static mock data whose shape matches `/api/flow` and
   `/api/transactions` **field for field**, so replacing mocks with real fetches is a
   one-file change with no component edits.
3. The dark terminal aesthetic is expressed as a **token layer**, so it is themeable
   rather than hardcoded per component.
4. The page is readable at 1280×720 without horizontal scrolling, and degrades to a
   usable (not necessarily dense) layout on a narrow window.
5. A developer can run it with two commands and see data without any backend.

## Non-Goals

- **No backend, no API calls, no fetch to Flask.** Mock data only. Explicitly requested.
- **No authentication.** A login screen exists as a demo gate that verifies nothing and
  says so; there is no session, no credential check, and no storage.
- **No writing to any table.** Read-only rendering.
- **No `wyckoff` page.** It exists in the reference (`wyckoff.html`) but the owner
  deferred it explicitly. It is the one reference page deliberately not covered.
- **No real-time updates, websockets, or polling.** Static snapshot.
- **No modification of `D:\zenith_saas`.** It is read-only reference.
- **No mobile app or native shell.**
- **No i18n.** English UI labels; `narrative` text from the backend is displayed as-is.
- **No order entry, no trade execution, no simulator controls.** Display only.

### Scope revision (2026-10-28, after first review)

The initial scope was the Flow page alone. The owner reviewed it and asked for **every
reference page except `wyckoff`**. The delivered scope is therefore:

| Page | Reference | Delivered |
|---|---|---|
| Hub | `hub.html` | ✅ |
| Flow (Smart/Bad Money) | `flow.html` | ✅ |
| Chart | `chart.html` | ✅ |
| Sector rotation | `sector.html` | ✅ |
| BSJP scanner | `bsjp.html` | ✅ |
| Portfolio simulation | `portfolio.html` | ✅ |
| Admin | `admin.html` | ✅ |
| Login | `login.html` | ✅ (demo gate, no backend) |
| Wyckoff | `wyckoff.html` | ❌ deferred by owner |

### Scope revision 2 (2026-10-28) — the date-range picker

**This should have been in the original PRD and was not. That was a defect.**

Every one of `flow.html`, `sector.html`, `chart.html`, `bsjp.html`, `portfolio.html`,
`admin.html`, and `wyckoff.html` contains a date control — I read those templates during
authoring and did not carry the requirement across. The reference implements it as
`StockbitDatePicker` in `static/zenith-utils.js` (L176+): a **range** picker with `from`
and `to`, a two-step click (start, then end), month navigation, prev/next-day steppers,
`1D/1W/1M/3M/1Y` presets, and an `onChange(from, to)` callback.

Delivered as `src/components/DatePicker.tsx` + `src/lib/date.ts`, on all six pages.

**One constraint worth stating plainly:** the reference's picker filters a real backend by
date. Here the data is static, so a picked range can only narrow data that actually varies
by date:

| Page | Per-row date? | Picker behaviour |
|---|---|---|
| Chart | Yes — 180 daily candles | **Real filter** on candle dates |
| Portfolio | Yes — per-trade `entry_date` | **Real filter** on the trade window |
| Admin | Yes — per-job `last_run` | **Real filter** on the job list |
| Flow | No — single-day snapshot | Snapshot date selector; warns when the picked range excludes it |
| Sector | No — single-day snapshot | Same as Flow |
| BSJP | No — single-day snapshot | Same as Flow |

The three snapshot pages say so in the UI rather than silently showing an empty table.

### Scope revision 3 (2026-10-28) — equity comparison on one axis

The first attempt at Wyckoff-vs-BSJP rendered **two separate charts side by side**. The
owner rejected that, correctly: two independently-scaled charts flatter whichever series
happens to have the wider range, and make a crossover between the strategies invisible.
Two charts is not a comparison.

Delivered instead: **one card, one chart, both strategies as lines on a shared Y axis**
(`src/components/MultiLineChart.tsx`), with a legend carrying each series' final value, a
dashed opening-capital baseline, and a compact comparison table beneath.

Also removed at the owner's request: the win/loss bar and its win-rate block under the
equity curve. `WIN RATE` and the W/L counts remain in the summary strip and the comparison
table, so no figure was lost.

---

## User Stories

Stories are ordered by dependency. A story never depends on a later story.

### US-001: Project scaffold that runs

**Description:** As a developer, I want a Vite + React + TypeScript project that starts,
so there is somewhere for every later story to land.

**Priority:** 1

**Acceptance Criteria:**
- [ ] `npm install` completes and `npm run dev` serves a page at a local URL
- [ ] `npm run build` completes with no TypeScript errors
- [ ] `npm run typecheck` (tsc --noEmit) exits 0
- [ ] TypeScript is in strict mode in `tsconfig.json`
- [ ] The dev server renders a placeholder heading; no other UI required yet
- [ ] Typecheck passes
- [ ] Tests pass

### US-002: Design token layer

**Description:** As a developer, I want the terminal's colours, spacing, and type in CSS
custom properties, so components consume tokens instead of hardcoded values.

**Priority:** 2

**Acceptance Criteria:**
- [ ] A single stylesheet defines custom properties for: background tiers, surface
      tiers, borders, text tiers, accent, up (positive), down (negative), warn, and
      phase colours
- [ ] Colour values are dark-terminal: near-black backgrounds, no value lighter than
      `#0a0a0a` for the base background
- [ ] Monospace font stack is defined for all numeric/code text
- [ ] A density scale is defined (row height, cell padding) as tokens
- [ ] No component stylesheet contains a raw hex colour — all colour comes via `var(--…)`
- [ ] A test or lint check asserts no raw hex outside the token file
- [ ] Typecheck passes
- [ ] Tests pass

### US-003: Typed domain model

**Description:** As a developer, I want TypeScript types mirroring the real API, so mock
data and future real data cannot drift apart silently.

**Priority:** 3

**Acceptance Criteria:**
- [ ] A `TickerRow` type declares exactly these fields, with the nullability the backend
      actually produces: `ticker` (string), `clean_money` (number|null), `sm_val`
      (number|null), `bm_val` (number|null), `rsm` (number|null), `mf_plus` (number|null),
      `mf_minus` (number|null), `net_mf` (number|null), `gain_pct` (number|null),
      `price` (number|null), `tx` (number), `phase` (Phase|null), `action` (string|null),
      `watch` (string|null), `sri` (number|null), `mes` (number|null), `volx_gap`
      (number|null), `rpr` (number|null), `atr_pct` (number|null), `sm_sma10`
      (number|null), `bm_sma10` (number|null), `vwap_sm` (number|null), `vwap_bm`
      (number|null), `ma5`/`ma13`/`ma34`/`ma200` (number|null), `rsi14` (number|null),
      `cm_streak` (number|null), `ma_structure` (string|null), `narrative` (string|null)
- [ ] A `Phase` union type contains exactly `SOS`, `UPTHRUST`, `ABSORB`, `SPRING`,
      `DISTRI`, `ACCUM`, `NEUTRAL`
- [ ] A `FlowTotals` type declares `sm`, `bm`, `mf_plus`, `mf_minus`, `net_cm`, `net_mf`,
      `count`
- [ ] A `FlowResponse` type declares `tickers`, `totals`, `date_from`, `date_to`
- [ ] A `TransactionRow` type declares `date`, `time`, `price`, `gain_pct`, `mf`, `mf_num`,
      `vol_x`, `signal`
- [ ] A `TransactionsResponse` type declares `ticker`, `sm`, `bm`, `sm_count`, `bm_count`
- [ ] A test asserts every field name matches the documented list exactly (a snapshot of
      the key set), so a rename is caught
- [ ] Typecheck passes
- [ ] Tests pass

### US-004: Mock dataset of realistic size

**Description:** As a developer, I want a mock dataset resembling a real IDX trading day,
so the UI is designed against realistic density and edge cases rather than three rows.

**Priority:** 4

**Acceptance Criteria:**
- [ ] A mock file exports a valid `FlowResponse` with **at least 60 tickers**
- [ ] Tickers use real IDX symbols (e.g. `BBCA`, `BBRI`, `TLKM`, `ASII`, `GOTO`)
- [ ] At least one ticker has `phase: null` and `action: null`, exercising the
      no-analytics path
- [ ] At least one ticker has `clean_money: null`
- [ ] At least one ticker has negative `clean_money`, and at least one positive
- [ ] All seven phase values appear at least once across the dataset
- [ ] `sm_val` and `bm_val` are in Juta and in a plausible range for IDX blue chips
- [ ] `totals` is internally consistent: `totals.sm` equals the sum of non-null `sm_val`,
      and likewise for `bm`
- [ ] At least one ticker has a `narrative` long enough to require truncation in the UI
      (150+ characters)
- [ ] A test asserts the dataset parses as `FlowResponse` and that the consistency and
      coverage rules above hold
- [ ] Typecheck passes
- [ ] Tests pass

### US-005: Mock transaction tapes

**Description:** As a developer, I want per-ticker SM/BM transaction lists in mock data,
so the detail panel can be built without a backend.

**Priority:** 5

**Acceptance Criteria:**
- [ ] A mock file exports `TransactionsResponse` objects keyed by at least 5 tickers
- [ ] Each tape has at least 12 rows split across `sm` and `bm`
- [ ] Each row's `date` uses `DD-MM-YYYY` format, matching the backend
- [ ] `signal` values come from a small closed set defined in one place (not scattered
      string literals across components)
- [ ] A lookup helper returns an empty tape (not `undefined`, not a throw) for a ticker
      with no mock data, so the UI has a defined behaviour for the miss
- [ ] A test asserts the fallback returns an empty tape with zero counts
- [ ] Typecheck passes
- [ ] Tests pass

### US-006: Number and currency formatting

**Description:** As a trader, I want large Juta values rendered compactly, so I can read
magnitude at a glance instead of counting digits.

**Priority:** 6

**Acceptance Criteria:**
- [ ] A formatter renders values ≥ 1,000,000 Juta as `B` (billions) and ≥ 1,000 as `M`
      (millions) with one decimal place, e.g. `1.2B`, `845.3M`
- [ ] A formatter renders percentages with a leading sign for non-zero values, e.g.
      `+2.31%`, `-0.85%`
- [ ] A formatter renders integers with thousands separators
- [ ] `null` renders as an em dash `—`, never as `0`, `NaN`, or `undefined`
- [ ] Negative zero renders as `0`, not `-0`
- [ ] A test covers each case above including `null` and negative-zero
- [ ] Typecheck passes
- [ ] Tests pass

### US-007: Phase and action presentation mapping

**Description:** As a trader, I want phases colour-coded consistently, so I can scan a
column for accumulation versus distribution without reading every label.

**Priority:** 7

**Acceptance Criteria:**
- [ ] A single module maps each of the seven phases to a label, a token-based colour, and
      a short description
- [ ] Accumulation-leaning phases (`SOS`, `SPRING`, `ABSORB`, `ACCUM`) map to up-tone
      colours; distribution-leaning (`UPTHRUST`, `DISTRI`) map to down-tone;
      `NEUTRAL` maps to a muted tone
- [ ] `null` phase maps to a defined "no data" presentation, visually distinct from
      `NEUTRAL` so an unanalysed ticker is never mistaken for a neutral one
- [ ] Colour is never the only signal — each phase also renders its text label
- [ ] A test asserts every phase in the `Phase` union has a mapping, and fails if a new
      phase is added without one
- [ ] Typecheck passes
- [ ] Tests pass

### US-008: Stat cards summary strip

**Description:** As a trader, I want the day's totals across the top, so I can see net
market flow before reading any individual ticker.

**Priority:** 8

**Acceptance Criteria:**
- [ ] A strip renders six values from `totals`: `sm`, `bm`, `net_cm`, `mf_plus`,
      `mf_minus`, `net_mf`, plus `count`
- [ ] `net_cm` and `net_mf` render green when positive and red when negative
- [ ] Each card shows a label and the formatted value; values use the US-006 formatter
- [ ] A missing value renders as `—` rather than collapsing the layout
- [ ] The strip does not wrap or overflow at 1280px width
- [ ] Verify in browser: open the app, confirm six cards render with formatted values and
      that positive/negative net values are coloured differently
- [ ] Typecheck passes
- [ ] Tests pass

### US-009: Ticker table rendering

**Description:** As a trader, I want the main table of all tickers, so the dashboard has
a usable core.

**Priority:** 9

**Acceptance Criteria:**
- [ ] A table renders one row per ticker from the `FlowResponse`
- [ ] Columns rendered: ticker, price, change %, SM, BM, Clean Money, RSM, SRI, tx,
      phase, action
- [ ] Rows are sorted by `clean_money` descending by default, with nulls last — matching
      the backend's own ordering
- [ ] Numeric columns are right-aligned and use a monospace/tabular figure so digits line
      up vertically
- [ ] Positive values in SM/Clean Money render in the up colour, negative in the down
      colour
- [ ] Null values render as `—`
- [ ] At 1280×720 the table shows at least 20 rows without page-level horizontal scroll
- [ ] The header row stays visible while the body scrolls
- [ ] Verify in browser: open the app, confirm rows render, are sorted by Clean Money
      descending, and that digits align in columns
- [ ] Typecheck passes
- [ ] Tests pass

### US-010: Sortable columns

**Description:** As a trader, I want to sort by any metric column, so I can find the
biggest accumulators or the heaviest distributors.

**Priority:** 10

**Acceptance Criteria:**
- [ ] Clicking a column header sorts by that column; clicking again reverses the direction
- [ ] The active sort column shows a direction indicator
- [ ] Sorting by a numeric column places null values last in both directions
- [ ] Sorting by `ticker` is alphabetical and case-insensitive
- [ ] The default on load remains Clean Money descending (US-009)
- [ ] Verify in browser: click the RSM header, confirm rows reorder; click again and
      confirm the order reverses and null-valued rows stay last
- [ ] Typecheck passes
- [ ] Tests pass

### US-011: Detail panel

**Description:** As a trader, I want to click a ticker and see its full picture, so I can
judge one name without leaving the table.

**Priority:** 11

**Acceptance Criteria:**
- [ ] Clicking a row opens a panel showing that ticker's full field set: MAs, RSI, ATR,
      vwap_sm, vwap_bm, sm_sma10, bm_sma10, mes, volx_gap, rpr, cm_streak, ma_structure,
      tx counts
- [ ] The panel shows the `narrative` text when present, and a defined empty state when
      null
- [ ] The selected row is visually indicated in the table
- [ ] The panel closes on Escape and on a close control
- [ ] The panel shows the phase with the same colour mapping as the table (US-007)
- [ ] Verify in browser: click a row, confirm the panel opens with that ticker's data;
      press Escape and confirm it closes; confirm the table row stays highlighted while open
- [ ] Typecheck passes
- [ ] Tests pass

### US-012: Transaction tape in the detail panel

**Description:** As a trader, I want to see individual SM and BM transactions for the
selected ticker, so I can see how the flow was built rather than just the total.

**Priority:** 12

**Acceptance Criteria:**
- [ ] The detail panel renders the ticker's `sm` and `bm` rows from the mock tape
- [ ] Each row shows time, price, gain %, MF, vol ×, and signal
- [ ] SM and BM are visually distinguished by more than colour (a label or column)
- [ ] A ticker with no mock tape shows an explicit empty state, not a blank area
- [ ] The tape is scrollable within the panel without scrolling the page
- [ ] Verify in browser: select a ticker with tape data and confirm rows render; select one
      without and confirm the empty state appears
- [ ] Typecheck passes
- [ ] Tests pass

### US-013: Density and theme toggle

**Description:** As a trader, I want to switch row density, so I can trade maximum
information on screen against readability.

**Priority:** 13

**Acceptance Criteria:**
- [ ] A control switches between at least two densities (compact, comfortable) for the
      table
- [ ] Density changes row height and cell padding via the tokens from US-002, not by
      per-component overrides
- [ ] The chosen density persists across a page reload
- [ ] Verify in browser: toggle density, confirm row height visibly changes, reload the
      page, and confirm the choice persisted
- [ ] Typecheck passes
- [ ] Tests pass

### US-014: Keyboard navigation

**Description:** As a trader, I want to move through the table without the mouse, so
scanning is fast and the tool is accessible.

**Priority:** 14

**Acceptance Criteria:**
- [ ] Arrow Up/Down move the selected row; the selection opens the detail panel (US-011)
- [ ] Escape closes the detail panel and returns focus to the table
- [ ] Every interactive control is reachable by Tab and shows a visible focus indicator
- [ ] The focused/selected row is distinguishable from the hover row
- [ ] Verify in browser: using only the keyboard, navigate down five rows, confirm the
      panel follows the selection, then press Escape and confirm focus returns to the table
- [ ] Typecheck passes
- [ ] Tests pass

### US-015: Empty, loading, and error states

**Description:** As a developer, I want the data layer's failure modes represented in the
UI, so swapping in the real API later does not surface an unhandled blank screen.

**Priority:** 15

**Acceptance Criteria:**
- [ ] The data layer exposes a status of loading / ready / error, even though mocks resolve
      immediately
- [ ] A loading state renders a skeleton or equivalent, not an empty page
- [ ] An error state renders the message and a retry control
- [ ] An empty dataset (zero tickers) renders an explicit empty message, with the stat
      strip still rendering rather than crashing
- [ ] A test drives the component through all four states
- [ ] Verify in browser: with an empty mock, confirm the empty message and that the page
      does not blank out
- [ ] Typecheck passes
- [ ] Tests pass

### US-016: Single-point data swap

**Description:** As a developer, I want one module that decides where data comes from, so
pointing at the real Flask API later is a one-file change.

**Priority:** 16

**Acceptance Criteria:**
- [ ] Exactly one module exports the data-access functions the UI consumes
- [ ] No component imports a mock file directly; all data arrives via that module
- [ ] The module reads an optional base-URL config; when unset it serves mocks, when set it
      fetches `${base}/api/flow` and `${base}/api/transactions` with the documented
      param names (`date_from`, `date_to`, `ticker`, `tf`)
- [ ] The real-API path is written but not exercised (no backend exists); its request URLs
      are asserted by tests using a stubbed fetch
- [ ] A test asserts that a component tree with the mock module produces the same rendered
      output shape as with a stubbed fetch returning equivalent JSON
- [ ] Typecheck passes
- [ ] Tests pass

---

## Functional Requirements

- FR-1: The application runs entirely on static mock data with no network calls when no
  base URL is configured.
- FR-2: Mock data conforms field-for-field to the `/api/flow` and `/api/transactions`
  response shapes.
- FR-3: The phase vocabulary is limited to `SOS`, `UPTHRUST`, `ABSORB`, `SPRING`,
  `DISTRI`, `ACCUM`, `NEUTRAL`.
- FR-4: All monetary values are displayed in Juta with `M`/`B` compaction above 1,000.
- FR-5: Every metric that renders a number uses tabular figures so columns align.
- FR-6: Null values are never displayed as zero and never as `NaN`/`undefined`.
- FR-7: Directional colour (up/down) is applied to signed metrics, and is never the sole
  carrier of meaning — a sign or label accompanies it.
- FR-8: The default table order is `clean_money` descending with nulls last.
- FR-9: Row density is controlled by tokens, not by per-component pixel values.
- FR-10: Exactly one module decides the data source, so the mock/real switch is one file.
- FR-11: The UI is legible on a dark background at WCAG AA for body text.
- FR-12: `D:\zenith_saas` is not written to by any part of this project.

---

## Technical Considerations

Constraints the requirements depend on. Not design decisions.

- **Stack, per the owner's decision:** Vite + React + TypeScript, standalone in
  `D:\zenith_saas_v2`. npm is the package manager (pnpm is not on PATH on this machine).
- **Verify commands for this project** (there is no AGENTS.md here yet — the scaffold
  story should create one): `npm run typecheck`, `npm run build`, `npm run test`.
- **The reference app's stack is Flask + Jinja + vanilla JS + hand-written CSS.** None of
  it is reusable as-is; it is a *data-shape and domain-vocabulary* reference.
- **The existing `tokens.css` (398 lines) is light-mode-first** and is being deliberately
  superseded. It is worth mining for the *structural* token names it already established,
  but its colour values do not apply.
- **`narrative` and some phase descriptions are Indonesian** and come from the backend.
  The frontend displays them verbatim and does not translate them.
- **`sm_val`/`bm_val`/`mf_plus`/`mf_minus` units are Juta**, inferred from the backend's
  own rounding and comment (`sm_val ... bm_val : Today's BM value (Juta)` in
  `algo_wyckoff.py` L29).
- **No CORS concern while mock-only.** When the real API is wired, the Flask app is
  key-gated and will need CORS or a proxy — noted as a future concern, not a requirement
  here.

---

## Success Metrics

- **Time to interactive from a cold clone:** `npm install && npm run dev` to a rendered
  table in under two minutes on this machine.
- **Density:** at 1280×720, at least 20 ticker rows visible with the header pinned, at
  compact density.
- **Scan fidelity:** digits in numeric columns align vertically — verified visually, since
  misalignment is the failure mode a terminal design exists to prevent.
- **Swap readiness:** changing to the real API requires editing exactly one file; measured
  by counting files that import mock data directly, which is 1 (the data module) and must
  stay 1.
- **Type safety:** zero `any` in `src/`, enforced by lint.
- **Coverage of the vocabulary:** every one of the seven phases has a rendering path
  exercised by at least one mock ticker.

---

## Open Questions

1. **The aesthetic conflict is resolved by fiat, not by evidence.** `tokens.css` currently
   argues explicitly *against* a dark, dense, long-session UI ("nothing here is meant to be
   looked at for eight hours and hurt"), while this PRD specifies dark and dense. The owner
   chose the terminal direction. Worth revisiting after one week of real use, since the
   original comment was presumably written for a reason. *Answerable by: owner, after use.*
2. **Charts are deferred.** The reference has `/api/overlay` and a 66 KB `chart.html`, and
   a price-vs-flow overlay is arguably the most informative view of "smart money". It is out
   of scope here to keep the PRD executable. Is that the right call, or is the overlay the
   actual point of the dashboard? *Answerable by: owner.*
3. **What does `action` mean, precisely?** The backend computes it from phase, gain, ATR,
   BM values, watch, and SRI (`algo_wyckoff.py` L88+). The frontend renders it but the
   mapping to colour/tone is not specified here beyond phase. Should `action` get its own
   colour scheme, or inherit the phase's? *Answerable by: owner.*
4. **Is `watch` a filter or a badge?** It appears in the API payload but its intended
   presentation is unspecified. *Answerable by: owner.*
5. **Single ticker view vs table-only.** This PRD puts everything in a side panel. If the
   real workflow is "study one ticker deeply", a dedicated route would serve better than a
   panel. *Answerable by: owner.*
6. **Mock symbol realism.** Mock tickers use real IDX symbols. If this frontend is ever
   shown publicly with mock numbers attached to real symbols, that is a factual-claims
   risk. Consider obviously-fake symbols for demo builds. *Answerable by: owner.*

---

## Handoff

This is the requirements document only — no schema, no library choices beyond the stack
decision the owner already made, no file layout, no code.

**Next step: `writing-plans`** to turn these 16 stories into a step-by-step implementation
plan. Because the stories are dependency-ordered and each carries its own verification,
the plan can be executed task-by-task, and several tasks can run in parallel once US-001
through US-007 have landed.
