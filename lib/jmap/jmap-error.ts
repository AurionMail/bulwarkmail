/**
 * JMAP errors carried on a thrown `Error`.
 *
 * A method error or a SetError names what went wrong in its `type`
 * (`overQuota`, `forbidden`, `invalidProperties`, ...) and, for
 * `invalidProperties`, which `properties` the server refused. Callers
 * branch on those instead of parsing the human-readable description, which
 * differs between servers and Stalwart releases.
 */

/** The parts of a JMAP method error or SetError a caller can branch on. */
export interface JmapErrorInfo {
  type?: string;
  description?: string;
  properties?: string[];
}

export type JmapError = Error & { jmapType?: string; jmapProperties?: string[] };

/** An `Error` with `message` that keeps the server's error type and properties. */
export function jmapError(message: string, info?: JmapErrorInfo | null): JmapError {
  const error: JmapError = new Error(message);
  if (info?.type) error.jmapType = info.type;
  if (info?.properties?.length) error.jmapProperties = [...info.properties];
  return error;
}

/** The JMAP error type a thrown value carries, if any. */
export function jmapErrorType(error: unknown): string | undefined {
  return (error as JmapError | null | undefined)?.jmapType;
}

/** The properties an `invalidProperties` error named, if any. */
export function jmapErrorProperties(error: unknown): string[] {
  return (error as JmapError | null | undefined)?.jmapProperties ?? [];
}
