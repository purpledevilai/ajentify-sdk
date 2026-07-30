export interface AjentifyErrorDetails {
  /** HTTP status code, when the error came from an API response. */
  status?: number;
  /** Machine-readable error code, when the API returned one. */
  code?: string;
  /** The parsed response body (object or string), when available. */
  body?: unknown;
}

/**
 * The single error type raised by the SDK. Network failures, non-2xx API
 * responses, and misconfiguration all surface as an `AjentifyError`. When the
 * error originates from an API response, `status`, `code`, and `body` are
 * populated so callers can branch on them.
 */
export class AjentifyError extends Error {
  override name = "AjentifyError";
  readonly status?: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, details: AjentifyErrorDetails = {}) {
    super(message);
    this.status = details.status;
    this.code = details.code;
    this.body = details.body;
    Object.setPrototypeOf(this, AjentifyError.prototype);
  }
}
