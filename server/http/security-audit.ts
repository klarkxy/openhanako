// @ts-nocheck
import { appendSecurityAuditEvent } from "../../core/security-audit-log.ts";
import { readAuthPrincipal } from "./capability-guard.ts";

export function recordSecurityAuditEvent(c, engine, {
  action,
  target = null,
  result = "success",
  secretFields = [],
  metadata = {},
  decision = null,
  leaseId = null,
  errorCode = null,
} = {}) {
  return appendSecurityAuditEvent(engine?.hanakoHome, {
    action,
    target,
    result,
    actor: readAuthPrincipal(c),
    decision,
    leaseId,
    errorCode,
    secretFields,
    metadata,
  });
}
