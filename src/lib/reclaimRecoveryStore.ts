interface RecoveryLinkRecord {
  readonly paymentId: string;
  readonly gatewayReference: string;
  readonly url: string;
  readonly createdAt: string;
}

const recoveryLinks =
  new Map<
    string,
    RecoveryLinkRecord
  >();

export function getRecoveryLink(
  paymentId: string,
):
  | RecoveryLinkRecord
  | undefined {
  return recoveryLinks.get(
    paymentId,
  );
}

export function setRecoveryLink(
  record: RecoveryLinkRecord,
): void {
  recoveryLinks.set(
    record.paymentId,
    record,
  );
}