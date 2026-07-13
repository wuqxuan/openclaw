/**
 * Formats an unknown rejection/throw value for provider stream terminal errors.
 *
 * Prefer Error.message; fall back to safe JSON, then String(). Never throw —
 * stream catch paths must still emit a terminal error event and end the stream.
 * Final conversion uses a constant literal if String() itself throws (for
 * example Object.create(null) or a throwing @@toPrimitive / valueOf / toString).
 */
export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Circular structures and other non-JSON values fall through to String().
  }
  try {
    return String(error);
  } catch {
    // String() is not guaranteed for null-prototype or hostile conversion hooks.
    return "Unknown error";
  }
}
