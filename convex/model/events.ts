// State machine transitions (D-07)
// draft -> active: Configuration complete, ready for guest import/QR
// active -> live: Event goes live for scanning (auto or manual)
// active -> draft: Revert to draft for changes (only before going live)
// live -> completed: Event ends
// completed -> archived: Long-term storage
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["live", "draft"],
  live: ["completed"],
  completed: ["archived"],
  archived: [],
};

export function getValidTransitions(currentStatus: string): string[] {
  return VALID_TRANSITIONS[currentStatus] ?? [];
}

export function validateTransition(
  currentStatus: string,
  newStatus: string,
): void {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${currentStatus} -> ${newStatus}. ` +
        `Allowed: ${allowed?.join(", ") ?? "none"}`,
    );
  }
}

export function isConfigLocked(status: string): boolean {
  // Config is locked once event goes live -- scanning may have started
  return status === "live" || status === "completed" || status === "archived";
}

export { VALID_TRANSITIONS };
