// ── @ResponseHeader ─────────────────────────────────────────────────────────
const RESPONSE_HEADERS_KEY = 'veloce:response_headers';

/**
 * Set a static response header on the decorated route. Stack it to set several.
 * A header the handler sets itself on the context wins.
 *
 * @example
 * ```ts
 * @Get('/report')
 * @ResponseHeader('Cache-Control', 'no-store')
 * report() {}
 * ```
 */
export function ResponseHeader(name: string, value: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing: Record<string, string> =
      Reflect.getMetadata(RESPONSE_HEADERS_KEY, target, propertyKey as string) ?? {};
    Reflect.defineMetadata(
      RESPONSE_HEADERS_KEY,
      { ...existing, [name]: value },
      target,
      propertyKey as string,
    );
  };
}

export function getResponseHeaders(target: any, propertyKey: string): Record<string, string> {
  return Reflect.getMetadata(RESPONSE_HEADERS_KEY, target.prototype ?? target, propertyKey) ?? {};
}

// ── @Redirect ───────────────────────────────────────────────────────────────
const REDIRECT_KEY = 'veloce:redirect';

export interface RedirectMeta {
  url: string;
  status: 301 | 302 | 307 | 308;
}

/**
 * Redirect the route to a fixed URL. The handler still runs first (for its side
 * effects, guards and validation); its return value is discarded.
 *
 * @example
 * ```ts
 * @Get('/docs')
 * @Redirect('/docs/latest', 301)
 * docs() {}
 * ```
 */
export function Redirect(url: string, status: 301 | 302 | 307 | 308 = 302): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      REDIRECT_KEY,
      { url, status } satisfies RedirectMeta,
      target,
      propertyKey as string,
    );
  };
}

export function getRedirect(target: any, propertyKey: string): RedirectMeta | undefined {
  return Reflect.getMetadata(REDIRECT_KEY, target.prototype ?? target, propertyKey);
}
