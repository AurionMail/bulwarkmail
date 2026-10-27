import type { JmapError, JmapErrorInfo } from './jmap-error';

/** A bulk destroy stopped before every requested message was confirmed deleted. */
export class IncompleteDeleteError extends Error implements JmapError {
  readonly destroyedIds: string[];
  readonly notDestroyed: Record<string, JmapErrorInfo>;
  readonly unknownIds: string[];
  readonly unattemptedIds: string[];
  jmapType?: string;
  jmapProperties?: string[];
  jmapSetError?: boolean;
  jmapFailedIds?: string[];

  constructor(progress: {
    destroyedIds: string[];
    notDestroyed: Record<string, JmapErrorInfo>;
    unknownIds: string[];
    unattemptedIds: string[];
  }, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Failed to delete emails: deletion was not confirmed', { cause });
    this.name = 'IncompleteDeleteError';
    this.destroyedIds = [...progress.destroyedIds];
    this.notDestroyed = { ...progress.notDestroyed };
    this.unknownIds = [...progress.unknownIds];
    this.unattemptedIds = [...progress.unattemptedIds];
    const metadata = cause as JmapError | undefined;
    this.jmapType = metadata?.jmapType;
    this.jmapProperties = metadata?.jmapProperties;
    this.jmapSetError = metadata?.jmapSetError;
    this.jmapFailedIds = metadata?.jmapFailedIds;
  }
}
