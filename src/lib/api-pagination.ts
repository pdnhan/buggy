import { NextResponse } from "next/server";

// Shared `?limit=` parsing for v1 list routes.
//
// `Number(searchParams.get("limit"))` turns a non-numeric value (e.g.
// `?limit=abc`) into `NaN`. `Math.min(Math.max(NaN, 1), max)` is still
// `NaN`, and Prisma's `take: NaN` throws inside the query, surfacing as an
// unhandled 500 instead of a validation error the caller can act on.
//
// Behavior, decided once here so every v1 list route is consistent:
//   - ABSENT `limit` → the route's own default (unchanged from before).
//   - non-integer / non-numeric / negative / zero → 400 with a clear
//     message (this is the case that used to reach Prisma as NaN).
//   - a valid but too-large value → CLAMPED to `maxLimit`, not a 400 —
//     this matches the pre-existing behavior (and pre-existing tests,
//     e.g. "clamps an out-of-range limit to 200 in the actual Prisma
//     call") of every route that had this pattern.
export function parseLimitParam(
  searchParams: URLSearchParams,
  defaultLimit: number,
  maxLimit: number
): { limit: number; error?: undefined } | { limit?: undefined; error: NextResponse } {
  const raw = searchParams.get("limit");
  if (raw === null) return { limit: defaultLimit };

  const trimmed = raw.trim();
  // Only accept a plain non-negative integer literal — this rejects "abc",
  // "1.5", "-1", "1e3", "", and whitespace-only values in one check, rather
  // than relying on Number()'s lenient (and NaN-prone) coercion.
  if (!/^\d+$/.test(trimmed)) {
    return {
      error: NextResponse.json(
        { error: "limit must be a positive integer." },
        { status: 400 }
      ),
    };
  }

  const parsed = Number(trimmed);
  if (parsed < 1) {
    return {
      error: NextResponse.json(
        { error: "limit must be a positive integer." },
        { status: 400 }
      ),
    };
  }

  return { limit: Math.min(parsed, maxLimit) };
}
