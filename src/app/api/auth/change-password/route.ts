export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ensureProjectForUser } from "@/lib/projects";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128).optional(),
  password: z.string().min(8).max(128),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = changePasswordSchema.parse(await request.json());

    // Verify user still exists (guard against stale JWT)
    const user = await db.user.findUnique({ where: { id: session.user.id } });
    if (!user) return NextResponse.json({ error: "Session invalid" }, { status: 401 });

    // A forced reset (mustChangePassword) means the user is holding a
    // temporary password an admin generated for them — they may not know
    // it, so current-password verification is skipped only in that case.
    // Everyone else must prove they hold the current password before we
    // rotate it, otherwise a hijacked/left-open session can lock the real
    // owner out.
    if (!user.mustChangePassword) {
      if (!body.currentPassword) {
        return NextResponse.json({ error: "Current password is required." }, { status: 400 });
      }
      if (!user.password || !(await verifyPassword(body.currentPassword, user.password))) {
        return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
      }
    }

    const passwordHash = await hashPassword(body.password);

    await db.user.update({
      where: { id: session.user.id },
      data: { password: passwordHash, mustChangePassword: false },
    });

    // Note: sessions here are JWT-based (see src/auth.ts) with no server-side
    // session store, so there is no mechanism to revoke a JWT already issued
    // to another device/browser — it stays valid until it expires on its own.
    await db.auditLog.create({
      data: { actorId: session.user.id, action: "password_change", targetId: session.user.id },
    });

    // Ensure new users get a project on first sign-in (invited users never
    // reach /dashboard directly — they're intercepted here first).
    await ensureProjectForUser(session.user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid password.", issues: error.issues },
        { status: 400 }
      );
    }
    console.error("Change password API error", error);
    return NextResponse.json({ error: "Unable to change password." }, { status: 500 });
  }
}
