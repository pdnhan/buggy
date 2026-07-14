import type { Prisma } from "@prisma/client";

export function auditLogEntry(
  client: Prisma.TransactionClient,
  data: { actorId: string; action: string; targetId: string; metadata?: Prisma.InputJsonValue }
) {
  return client.auditLog.create({ data });
}
