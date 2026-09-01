// Standardized application error with an attached HTTP status code.
export class AppError extends Error {
  statusCode: number;
  // Builds an operational error instance for middleware error handling.
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}
