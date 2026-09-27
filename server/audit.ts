export type AuditWriteContext = {
  action: string;
  targetType?: string;
};

export class AuditLogWriteError extends Error {
  readonly action: string;
  readonly targetType: string | null;

  constructor(context: AuditWriteContext) {
    super("Audit log write failed");
    this.name = "AuditLogWriteError";
    this.action = context.action;
    this.targetType = context.targetType || null;
  }
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.slice(0, 32) : undefined;
}

export async function writeAuditRecord(
  write: () => Promise<unknown>,
  context: AuditWriteContext,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error("[Audit] Audit record could not be persisted", {
      action: context.action,
      targetType: context.targetType || null,
      errorCode: getDatabaseErrorCode(error),
    });
    throw new AuditLogWriteError(context);
  }
}
