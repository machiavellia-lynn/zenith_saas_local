/**
 * Static mock of the hub's market snapshot.
 *
 * Shape comes from `types.pages.ts` (`MarketSnapshot`). The reference serves
 * the live quote from `price_cache.get_cached_ihsg()` via `GET /api/ihsg`
 * (D:\zenith_saas\routes\routes_main.py L94-99) and the session state from
 * `price_cache._is_market_open()`; only the response shape is mirrored here.
 *
 * `as_of` and `time` are fixed literals rather than the wall clock — the
 * terminal is a static mock, and a header that changed on every render would
 * make every screenshot and every test disagree.
 */

import type { MarketSnapshot } from "../types.pages";

/** The session this snapshot describes, and its state. */
export const SNAPSHOT_STATUS: MarketSnapshot["status"] = "CLOSED";

/** Mock market snapshot for the hub header. */
export const mockSnapshot: MarketSnapshot = {
  // IHSG's level through 2026, inside the 7,000–7,800 band the hub was
  // designed against.
  ihsg: 7_412.63,
  ihsg_gain_pct: 0.84,
  as_of: "2026-10-02",
  time: "16:15:00",
  status: SNAPSHOT_STATUS,
};
