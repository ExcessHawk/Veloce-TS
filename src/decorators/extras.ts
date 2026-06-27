// ── @Throttle ───────────────────────────────────────────────────────────────
const THROTTLE_KEY = 'veloce:throttle';

export interface ThrottleOptions {
  limit: number;
  windowMs: number;
}

export function Throttle(limit: number, windowMs: number): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    const meta: ThrottleOptions = { limit, windowMs };
    if (propertyKey !== undefined) {
      Reflect.defineMetadata(THROTTLE_KEY, meta, target, propertyKey as string);
    } else {
      Reflect.defineMetadata(THROTTLE_KEY, meta, target);
    }
  };
}

export function getThrottle(target: any, propertyKey?: string): ThrottleOptions | undefined {
  if (propertyKey) {
    return (
      Reflect.getMetadata(THROTTLE_KEY, target.prototype ?? target, propertyKey) ??
      Reflect.getMetadata(THROTTLE_KEY, target.prototype ?? target)
    );
  }
  return Reflect.getMetadata(THROTTLE_KEY, target);
}

// ── @ApiVersion ─────────────────────────────────────────────────────────────
const VERSION_KEY = 'veloce:version';

/** Prefix routes in this controller/method with /v{version}. */
export function ApiVersion(version: string): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey !== undefined) {
      Reflect.defineMetadata(VERSION_KEY, version, target, propertyKey as string);
    } else {
      Reflect.defineMetadata(VERSION_KEY, version, target);
    }
  };
}

export function getApiVersion(target: any, propertyKey?: string): string | undefined {
  if (propertyKey) return Reflect.getMetadata(VERSION_KEY, target.prototype ?? target, propertyKey);
  return Reflect.getMetadata(VERSION_KEY, target);
}

// ── @ResponseHeader ─────────────────────────────────────────────────────────
const RESPONSE_HEADERS_KEY = 'veloce:response_headers';

/** Set a static response header on the decorated method. */
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

/** Redirect the route to a fixed URL. */
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
