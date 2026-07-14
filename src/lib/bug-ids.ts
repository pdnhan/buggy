import type { Prisma } from "@prisma/client";

const BUG_PREFIX = "BUG";

export function formatBugDisplayId(sequence: number) {
  const seq = Math.max(1, sequence);
  return `${BUG_PREFIX}-${String(seq).padStart(4, "0")}`;
}

export async function reserveBugDisplayIds(
  tx: Prisma.TransactionClient,
  projectId: string,
  count: number
) {
  if (count < 1) {
    throw new Error("count must be at least 1");
  }

  const project = await tx.project.update({
    where: { id: projectId },
    data: { bugCounter: { increment: count } },
    select: { bugCounter: true },
  });

  const lastSequence = project.bugCounter;
  const start = lastSequence - count + 1;

  return Array.from({ length: count }, (_, idx) => formatBugDisplayId(start + idx));
}
