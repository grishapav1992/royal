export const operationReplayed = Symbol('operationReplayed');

/** Attach the committed decision for the observer without changing the transport payload. */
export function markOperationAttempt<T extends object>(result: T, replayed: boolean): T {
  return Object.defineProperty(result, operationReplayed, { value: replayed });
}
