const processedEventIds = new Map<string, number>();

const inFlightEvents =
  new Map<string, Promise<void>>();

const MAX_PROCESSED_EVENTS = 5000;

const EVENT_TTL_MS =
  24 * 60 * 60 * 1000;

function cleanupProcessedEvents(): void {
  const now = Date.now();

  for (const [
    eventId,
    timestamp,
  ] of processedEventIds) {
    if (
      now - timestamp >
      EVENT_TTL_MS
    ) {
      processedEventIds.delete(eventId);
    }
  }

  while (
    processedEventIds.size >
    MAX_PROCESSED_EVENTS
  ) {
    const oldest =
      processedEventIds.keys().next().value;

    if (
      typeof oldest !== "string"
    ) {
      break;
    }

    processedEventIds.delete(oldest);
  }
}

export function hasProcessedEvent(
  eventId: string,
): boolean {
  cleanupProcessedEvents();

  return processedEventIds.has(
    eventId,
  );
}

export function markEventProcessed(
  eventId: string,
): void {
  cleanupProcessedEvents();

  processedEventIds.set(
    eventId,
    Date.now(),
  );
}

export function getInFlightEvent(
  eventId: string,
): Promise<void> | undefined {
  return inFlightEvents.get(
    eventId,
  );
}

export function registerInFlightEvent(
  eventId: string,
  promise: Promise<void>,
): void {
  inFlightEvents.set(
    eventId,
    promise,
  );
}

export function clearInFlightEvent(
  eventId: string,
): void {
  inFlightEvents.delete(
    eventId,
  );
}