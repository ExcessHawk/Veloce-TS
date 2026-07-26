/**
 * ORM-layer errors.
 */

/**
 * Thrown when a repository method has no safe/efficient default implementation
 * and MUST be overridden by an ORM-specific adapter (or a custom subclass).
 *
 * The old BaseRepository fallbacks for count/updateMany/deleteMany loaded every
 * matching row into memory and looped over it — a silent full-table scan.
 * An explicit error at call time is preferable to that footgun.
 */
export class NotImplementedError extends Error {
  /** Name of the repository method that lacks an implementation. */
  readonly method: string;

  constructor(method: string, message?: string) {
    super(
      message ??
        `${method} is not implemented by this repository. ` +
          `The BaseRepository default was removed because it loaded all matching rows into memory. ` +
          `Override ${method} with a native query in your adapter, or use a built-in adapter ` +
          `(PrismaRepository, TypeORMRepository, DrizzleRepository) which implements it efficiently.`
    );
    this.name = 'NotImplementedError';
    this.method = method;
  }
}
