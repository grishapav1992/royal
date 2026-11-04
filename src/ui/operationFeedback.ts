/** Pending is saved before a request starts. Recovery is offered only after it stops. */
export function canRecoverOperation(client: {pending?: unknown; busy: boolean; loading?: boolean}): boolean {
  return !!client.pending && !client.busy && !client.loading;
}
