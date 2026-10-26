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

export type JmapError = Error & {
  jmapType?: string;
  jmapProperties?: string[];
  jmapSetError?: boolean;
  jmapFailedIds?: string[];
};

/** An `Error` with `message` that keeps the server's error type and properties. */
export function jmapError(message: string, info?: JmapErrorInfo | null): JmapError {
  const error: JmapError = new Error(message);
  if (info?.type) error.jmapType = info.type;
  if (info?.properties?.length) error.jmapProperties = [...info.properties];
  return error;
}

/**
 * {@link jmapError} for a SetError: the server looked at one object of a /set
 * call and refused it (`notCreated`, `notUpdated`, `notDestroyed`, RFC 8620
 * §5.3), as opposed to refusing the whole method call. The same type can come
 * either way (`forbidden` is both), and only the SetError says something about
 * that object.
 */
export function jmapSetError(message: string, info?: JmapErrorInfo | null): JmapError {
  const error = jmapError(message, info);
  error.jmapSetError = true;
  return error;
}

/** Whether a thrown value is a SetError (see {@link jmapSetError}). */
export function isJmapSetError(error: unknown): boolean {
  return (error as JmapError | null | undefined)?.jmapSetError === true;
}

/** The JMAP error type a thrown value carries, if any. */
export function jmapErrorType(error: unknown): string | undefined {
  return (error as JmapError | null | undefined)?.jmapType;
}

/** The properties an `invalidProperties` error named, if any. */
export function jmapErrorProperties(error: unknown): string[] {
  return (error as JmapError | null | undefined)?.jmapProperties ?? [];
}

/**
 * The objects a write of several left unchanged, when the error names them: a
 * /set refuses objects one by one and applies the rest. Null when it doesn't
 * say (after a failed request, for one), so any of them may be unchanged.
 */
export function jmapErrorFailedIds(error: unknown): string[] | null {
  return (error as JmapError | null | undefined)?.jmapFailedIds ?? null;
}
