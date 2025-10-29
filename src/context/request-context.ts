/**
 * Request Context for tracking request lifecycle
 * Provides Request ID, AbortSignal, timeouts, and shared context across middleware and handlers
 */

import type { Context } from '../types';

/**
 * Request Context stored in Hono's context
 */
export interface RequestContext {
  requestId: string;
  startTime: number;
  abortSignal: AbortSignal;
  abortController: AbortController;
  timeout?: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  metadata: Record<string, any>;
}

const REQUEST_CONTEXT_KEY = 'veloce:request-context';

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Get request context from Hono context
 */
export function getRequestContext(c: Context): RequestContext | null {
  return c.get(REQUEST_CONTEXT_KEY) || null;
}

/**
 * Set request context in Hono context
 */
export function setRequestContext(c: Context, context: RequestContext): void {
  c.set(REQUEST_CONTEXT_KEY, context);
}

/**
 * Initialize request context for a new request
 * Creates a UUID, AbortSignal, and optionally sets up timeout
 */
export function initializeRequestContext(
  c: Context,
  options?: {
    requestId?: string;
    timeout?: number;
  }
): RequestContext {
  const requestId = options?.requestId || generateRequestId();
  const abortController = new AbortController();
  
  const context: RequestContext = {
    requestId,
    startTime: Date.now(),
    abortSignal: abortController.signal,
    abortController,
    timeout: options?.timeout,
    metadata: {}
  };

  // Set up timeout if provided
  if (options?.timeout && options.timeout > 0) {
    context.timeoutId = setTimeout(() => {
      abortController.abort();
    }, options.timeout);
  }

  setRequestContext(c, context);
  return context;
}

/**
 * Get request ID from context
 */
export function getRequestId(c: Context): string | null {
  const ctx = getRequestContext(c);
  return ctx?.requestId || null;
}

/**
 * Get AbortSignal from context
 */
export function getAbortSignal(c: Context): AbortSignal | null {
  const ctx = getRequestContext(c);
  return ctx?.abortSignal || null;
}

/**
 * Abort the current request
 */
export function abortRequest(c: Context): void {
  const ctx = getRequestContext(c);
  if (ctx?.abortController && !ctx.abortSignal.aborted) {
    ctx.abortController.abort();
  }
}

/**
 * Set metadata in request context
 */
export function setRequestMetadata(c: Context, key: string, value: any): void {
  const ctx = getRequestContext(c);
  if (ctx) {
    ctx.metadata[key] = value;
  }
}

/**
 * Get metadata from request context
 */
export function getRequestMetadata(c: Context, key: string): any {
  const ctx = getRequestContext(c);
  return ctx?.metadata[key];
}

/**
 * Get request duration in milliseconds
 */
export function getRequestDuration(c: Context): number | null {
  const ctx = getRequestContext(c);
  if (!ctx) return null;
  return Date.now() - ctx.startTime;
}

/**
 * Clean up request context (clear timeout, etc.)
 */
export function cleanupRequestContext(c: Context): void {
  const ctx = getRequestContext(c);
  if (ctx?.timeoutId) {
    clearTimeout(ctx.timeoutId);
  }
}
