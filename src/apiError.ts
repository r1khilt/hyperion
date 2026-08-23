export class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
