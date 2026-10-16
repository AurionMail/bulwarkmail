/**
 * Principal/query or Principal/get failed. `type` is the JMAP method error
 * (`forbidden` when the server does not let this account query the
 * directory), or null when the request itself failed.
 */
export class PrincipalsRequestError extends Error {
  constructor(readonly type: string | null, description?: string) {
    super(description || type || 'Failed to fetch principals');
    this.name = 'PrincipalsRequestError';
  }
}
