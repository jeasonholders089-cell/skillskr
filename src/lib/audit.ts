import { run } from "../db.ts";
import { newAuditId } from "./ids.ts";
import { nowIso } from "./http.ts";

export function audit(entry: {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): void {
  try {
    run(
      `INSERT INTO audit_log (id, tenant_id, actor_user_id, action, target_type, target_id,
                              metadata_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newAuditId(),
      entry.tenantId ?? null,
      entry.actorUserId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ip ?? null,
      nowIso()
    );
  } catch (err) {
    // Auditing must never break the request it is describing.
    console.error("[audit] failed to write entry", entry.action, err);
  }
}
