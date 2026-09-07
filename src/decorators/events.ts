/**
 * @module veloce-ts/decorators/events
 * @description `@On('event')` — declarative event listeners, the decorator
 * counterpart to `globalEvents.on(...)`.
 *
 * A class carrying `@On` methods is registered with `app.include()` like a
 * controller. Instances are resolved through the DI container, so a listener can
 * inject the same services a controller can, and subscriptions are removed again
 * on `app.shutdown()` — without that, listeners registered against the global
 * bus would accumulate across app instances in a test suite.
 */
import 'reflect-metadata';

const EVENT_LISTENERS_KEY = Symbol('events:listeners');

/** One `@On`-decorated method. */
export interface EventListenerMetadata {
  /** Event name passed to the decorator. */
  event: string;
  /** Method to invoke on the resolved instance. */
  propertyKey: string;
  /** Registered with `once()` rather than `on()`. */
  once: boolean;
}

export interface OnOptions {
  /** Unsubscribe after the first delivery. */
  once?: boolean;
}

/**
 * Subscribe a method to an event on the application's bus.
 *
 * @param event - event name, e.g. `'user.created'`
 *
 * @example
 * ```typescript
 * class NotificationListeners {
 *   @On('user.created')
 *   async welcome(payload: { email: string }) {
 *     await mailer.send(payload.email, 'Welcome!');
 *   }
 *
 *   @On('app.ready', { once: true })
 *   warmCaches() { … }
 * }
 *
 * app.include(NotificationListeners);
 * ```
 *
 * A throwing listener does not stop the others: `EventBus.emit` settles every
 * handler and rethrows the failures together as an `AggregateError`.
 */
export function On(event: string, options: OnOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const listeners: EventListenerMetadata[] =
      Reflect.getMetadata(EVENT_LISTENERS_KEY, target.constructor) ?? [];

    listeners.push({
      event,
      propertyKey: propertyKey as string,
      once: options.once === true,
    });

    Reflect.defineMetadata(EVENT_LISTENERS_KEY, listeners, target.constructor);
  };
}

/**
 * The `@On` methods declared on a class.
 *
 * Accepts the constructor or its prototype, so it can be called from a decorator
 * (which receives the prototype) or from `include()` (which has the class).
 */
export function getEventListeners(target: any): EventListenerMetadata[] {
  const ctor = typeof target === 'function' ? target : target?.constructor;
  if (!ctor) return [];
  return Reflect.getMetadata(EVENT_LISTENERS_KEY, ctor) ?? [];
}

/** Whether a class declares any `@On` method. */
export function hasEventListeners(target: any): boolean {
  return getEventListeners(target).length > 0;
}
