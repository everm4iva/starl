/*
 * ☆ HttpError
 * -> a thrown error carrying an HTTP status + a `detail` string, matching the old
 *    FastAPI {"detail": "..."} error body the client already parses
 * -> for some reason i like small codes.
 */

export class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export const httpError = (status, detail) => new HttpError(status, detail);
