/** Shared error contract, with no blockchain runtime dependencies. */
export class NilePlayError extends Error {
  constructor(readonly code:string,readonly status=409){super(code);}
}
