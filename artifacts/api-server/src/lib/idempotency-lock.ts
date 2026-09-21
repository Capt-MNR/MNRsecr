type Identity = {
  tenantId: string;
  userId: string;
};

const inFlight = new Map<string, Promise<unknown>>();

function scopedKey(identity: Identity, key: string): string {
  return `${identity.tenantId}\u0000${identity.userId}\u0000${key}`;
}

/**
 * Coordinate retries that arrive while the original request is still running.
 * The database record remains the durable source of truth; this lock closes the
 * small window between the first read and the final idempotency write.
 */
export async function runWithIdempotencyLock<T>(
  identity: Identity,
  key: string | null | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!key) return work();

  const lockKey = scopedKey(identity, key);
  const existing = inFlight.get(lockKey);
  if (existing) return existing as Promise<T>;

  const current = Promise.resolve().then(work);
  inFlight.set(lockKey, current);
  try {
    return await current;
  } finally {
    if (inFlight.get(lockKey) === current) inFlight.delete(lockKey);
  }
}