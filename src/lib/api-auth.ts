import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { LRUCache } from "lru-cache";
import type { ApiKey, ApiKeyScope, Project, User } from "@prisma/client";
import { db } from "./db";
import {
  normalizeLoginIdentifier,
  recordLoginFailure,
  recordLoginSuccess,
} from "./login-throttle";

export type ApiKeyWithProject = ApiKey & { project: Project };

// In-process LRU cache for resolved API keys (per-process, not shared across replicas).
// TTL 60s avoids repeated bcrypt on hot paths. Revoked keys remain valid up to 60s.
const keyCache = new LRUCache<string, ApiKeyWithProject>({
  max: 500,
  ttl: 60_000,
});

// Extracts the raw key from a `Bearer <key>` Authorization header, used by
// every public v1 API route (src/app/api/v1/**).
export function bearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function isExpired(key: ApiKeyWithProject): boolean {
  return key.expiresAt !== null && key.expiresAt <= new Date();
}

export async function resolveApiKey(rawKey: string): Promise<ApiKeyWithProject | null> {
  if (!rawKey) return null;

  const cached = keyCache.get(rawKey);
  if (cached) {
    // Re-check expiry on cache hit — a key can expire mid-TTL, and the cache
    // otherwise keeps serving it as valid for up to 60s past that point.
    if (isExpired(cached)) {
      keyCache.delete(rawKey);
      return null;
    }
    return cached;
  }

  const keyPrefix = rawKey.slice(0, 8);
  if (!keyPrefix) return null;

  const candidates = await db.apiKey.findMany({
    where: { keyPrefix, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { project: true },
  });

  for (const candidate of candidates) {
    const valid = await bcrypt.compare(rawKey, candidate.keyHash);
    if (valid) {
      keyCache.set(rawKey, candidate);
      return candidate;
    }
  }

  return null;
}

// CQ-128/CQ-13x: same per-account failure throttle as src/auth.ts's
// credentials authorize() (shared module: src/lib/login-throttle.ts), keyed
// identically (normalizeLoginIdentifier). This is the login surface for
// BASIC_AUTH_PATHS in src/proxy.ts (POST/DELETE /api/v1/api-keys,
// /api/v1/projects) — a raw email+password guessing surface exactly like
// the credentials login, so it must not be exempt from the same account
// protection, and (per the "count only FAILED attempts, clear on success"
// fix) must not let a wrong-guess flood lock out a legitimate CI account
// either.
export async function resolveBasicAuth(authHeader: string | null): Promise<User | null> {
  if (!authHeader?.startsWith("Basic ")) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;

  const email = normalizeLoginIdentifier(decoded.slice(0, colonIdx));
  const password = decoded.slice(colonIdx + 1);

  if (!email || !password) return null;

  const user = await db.user.findUnique({ where: { email } });
  if (!user?.password) {
    recordLoginFailure(email);
    return null;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    recordLoginFailure(email);
    return null;
  }

  recordLoginSuccess(email);
  return user;
}

export function generateApiKey(): { rawKey: string; keyPrefix: string } {
  const rawKey = randomBytes(32).toString("hex");
  return { rawKey, keyPrefix: rawKey.slice(0, 8) };
}

export async function hashApiKey(rawKey: string): Promise<string> {
  return bcrypt.hash(rawKey, 10);
}

export function scopeCheck(scope: ApiKeyScope) {
  return scope === "READ_ONLY";
}
