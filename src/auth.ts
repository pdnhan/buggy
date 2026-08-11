import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import {
  normalizeLoginIdentifier,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-throttle";

// How often to re-read isWorkspaceAdmin/mustChangePassword from the DB for
// an already-issued JWT. Without this, both claims are baked into the token
// only at sign-in and stay stale for the life of the session (NextAuth's
// default is 30 days) — an admin demotion or a forced password reset would
// otherwise have no effect on a user who is already logged in.
const CLAIM_REFRESH_INTERVAL_MS = 60_000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(db),
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // CQ-128/CQ-13x: this is the ONE place credentials.email is parsed —
        // NextAuth (@auth/core) has already read it from the request body
        // before calling authorize(), so there is no second parser here to
        // drift from it. Per-account throttling below is keyed on exactly
        // this normalized value. See src/lib/login-throttle.ts for the full
        // history and the (a)/(b) tradeoff this authorize() implements.
        const normalizedEmail = normalizeLoginIdentifier(String(credentials.email));

        const user = await db.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!user || !user.password) {
          recordLoginFailure(normalizedEmail);
          return null;
        }

        const isPasswordValid = await verifyPassword(
          credentials.password as string,
          user.password
        );

        if (!isPasswordValid) {
          const status = recordLoginFailure(normalizedEmail);
          if (status.throttled) {
            // Observability only — choice (b) means we still let a correct
            // password through, so this can't gate the outcome. It's here
            // so a sustained attack against one account is at least visible
            // in logs even though it can no longer be blocked outright
            // without reintroducing the lockout DoS (see login-throttle.ts).
            console.warn(
              `[auth] Repeated failed login attempts for account (${status.failureCount} in window)`
            );
          }
          return null;
        }

        recordLoginSuccess(normalizedEmail);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          isWorkspaceAdmin: user.isWorkspaceAdmin,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.isWorkspaceAdmin = user.isWorkspaceAdmin ?? false;
        token.mustChangePassword = user.mustChangePassword ?? false;
        token.claimsRefreshedAt = Date.now();
        return token;
      }

      // Every call to auth() re-invokes this callback (not just sign-in).
      // Periodically re-read the privilege-bearing claims so a demotion or
      // forced password reset takes effect within ~a minute instead of
      // waiting out the session lifetime.
      const refreshedAt = (token.claimsRefreshedAt as number | undefined) ?? 0;
      const tokenId = token.id as string | undefined;
      if (tokenId && Date.now() - refreshedAt > CLAIM_REFRESH_INTERVAL_MS) {
        try {
          const current = await db.user.findUnique({
            where: { id: tokenId },
            select: { isWorkspaceAdmin: true, mustChangePassword: true },
          });
          if (current) {
            token.isWorkspaceAdmin = current.isWorkspaceAdmin;
            token.mustChangePassword = current.mustChangePassword;
          } else {
            // CQ-122: the user row is gone (deleted). There is no downstream
            // lookup that rejects a deleted user's session — src/proxy.ts
            // only counts admins for the setup gate, and /api/admin/**
            // route handlers check only this JWT claim — so leaving the
            // stale claims in place would keep a deleted workspace admin's
            // /api/admin/** access alive for up to the JWT's 30-day
            // lifetime. Invalidate the privileged claims instead.
            token.isWorkspaceAdmin = false;
            token.mustChangePassword = false;
          }
          token.claimsRefreshedAt = Date.now();
        } catch (err) {
          // CQ-119: a DB blip must not become a total auth outage. Fail
          // CLOSED — keep the existing token claims exactly as they are (no
          // upgrade, no downgrade) instead of letting this throw out of the
          // jwt callback, which would make auth() resolve to null for every
          // signed-in user (both the admin gate and the mustChangePassword
          // gate fall through when that happens). Leave claimsRefreshedAt
          // untouched so the very next request retries the refresh rather
          // than waiting out the full interval while the claims stay stale.
          console.error(
            "[auth] Failed to refresh privilege claims from DB; keeping existing token claims",
            err
          );
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isWorkspaceAdmin = (token.isWorkspaceAdmin as boolean) ?? false;
        session.user.mustChangePassword = (token.mustChangePassword as boolean) ?? false;
      }
      return session;
    },
  },
});
