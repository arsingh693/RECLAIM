export type AuditEventType =
  | "RECOVERY_EVALUATED"
  | "RECOVERY_BLOCKED"
  | "RECOVERY_LINK_CREATED"
  | "RECOVERY_LINK_FAILED";

export interface RecoveryAuditEvent {
  readonly id: string;
  readonly eventType: AuditEventType;
  readonly paymentId: string;
  readonly eventId: string | null;
  readonly intervention: string | null;
  readonly status: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

const auditEvents: RecoveryAuditEvent[] = [];

const MAX_AUDIT_EVENTS = 5000;

function createAuditId(): string {
  return `audit_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function appendAuditEvent(
  event: Omit<
    RecoveryAuditEvent,
    "id" | "createdAt"
  >,
): RecoveryAuditEvent {
  const record: RecoveryAuditEvent = {
    ...event,
    id: createAuditId(),
    createdAt: new Date().toISOString(),
  };

  auditEvents.push(record);

  while (
    auditEvents.length >
    MAX_AUDIT_EVENTS
  ) {
    auditEvents.shift();
  }

  return record;
}

export function getAuditEvents(
  paymentId?: string,
): RecoveryAuditEvent[] {
  if (!paymentId) {
    return [...auditEvents].reverse();
  }

  return auditEvents
    .filter(
      (event) =>
        event.paymentId === paymentId,
    )
    .reverse();
}