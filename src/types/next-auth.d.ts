import { DefaultSession } from "next-auth";

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    isWorkspaceAdmin: boolean;
    mustChangePassword: boolean;
    // Epoch ms of the last time isWorkspaceAdmin/mustChangePassword were
    // re-read from the DB. See src/auth.ts jwt callback — these claims are
    // baked into the token at sign-in and would otherwise stay stale for the
    // life of the session (default 30 days) even after an admin revokes them.
    claimsRefreshedAt: number;
  }
}

declare module "next-auth" {
  interface User {
    isWorkspaceAdmin?: boolean;
    mustChangePassword?: boolean;
  }
  interface Session {
    user: {
      id: string;
      isWorkspaceAdmin: boolean;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
}
