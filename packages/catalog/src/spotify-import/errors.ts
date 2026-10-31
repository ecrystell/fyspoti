/** Messages name files and fields only, never the user's data, so they are safe to show or log. */
export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}
