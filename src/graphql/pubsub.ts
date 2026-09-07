/**
 * @module veloce-ts/graphql/pubsub
 * @description Topic-based publish/subscribe exposing each topic as an
 * `AsyncIterableIterator`, which is the shape `graphql`'s `subscribe()` wants
 * from a subscription field.
 *
 * It is a thin layer over {@link EventBus}: publishing is an emit, subscribing
 * attaches a listener that feeds a per-subscriber queue. Sharing the bus means
 * an `@On('user.created')` listener and a GraphQL subscription can react to the
 * same publish.
 */
import { EventBus, globalEvents } from '../events/event-bus.js';
import { getLogger } from '../logging/logger.js';

/** How a subscriber behaves when it cannot keep up with the publisher. */
export type BackpressureStrategy =
  /** Drop the oldest queued payload to make room. Keeps the newest state. */
  | 'drop-oldest'
  /** Drop the incoming payload. Keeps the oldest, preserving order from the start. */
  | 'drop-newest'
  /** End the subscription with an error. */
  | 'error';

export interface PubSubOptions {
  /**
   * Bus to publish on. Defaults to a private bus, so two `new PubSub()`
   * instances do not see each other's topics. Pass `globalEvents` (or your own
   * bus) to share topics with `@On` listeners.
   */
  eventBus?: EventBus;

  /**
   * Payloads a single subscriber may have queued before the backpressure
   * strategy kicks in. A slow consumer otherwise grows this queue without
   * bound.
   *
   * @default 1000
   */
  maxQueueSize?: number;

  /** @default 'drop-oldest' */
  backpressure?: BackpressureStrategy;
}

/** Raised on a subscriber that fell behind while `backpressure` is `'error'`. */
export class SubscriberOverflowError extends Error {
  constructor(public readonly topic: string, public readonly maxQueueSize: number) {
    super(
      `Subscriber on "${topic}" fell behind: more than ${maxQueueSize} payloads queued. ` +
      'Consume faster, raise maxQueueSize, or pick a dropping backpressure strategy.'
    );
    this.name = 'SubscriberOverflowError';
  }
}

/**
 * @example
 * ```typescript
 * const pubsub = new PubSub();
 *
 * @Resolver()
 * class UserResolver {
 *   @GQLSubscription()
 *   @Returns(UserSchema)
 *   onUserCreated() {
 *     return pubsub.subscribe<User>('USER_CREATED');
 *   }
 *
 *   @GQLMutation()
 *   async createUser(@Arg('input', CreateUser) input: CreateUser) {
 *     const user = await db.insert(input);
 *     await pubsub.publish('USER_CREATED', user);
 *     return user;
 *   }
 * }
 * ```
 */
export class PubSub {
  private readonly bus: EventBus;
  private readonly maxQueueSize: number;
  private readonly backpressure: BackpressureStrategy;

  /** Live subscribers per topic, so `close()` can end them all. */
  private readonly subscribers = new Map<string, Set<{ end: () => void }>>();

  constructor(options: PubSubOptions = {}) {
    this.bus = options.eventBus ?? new EventBus();
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.backpressure = options.backpressure ?? 'drop-oldest';
  }

  /** The bus this instance publishes on. */
  getEventBus(): EventBus {
    return this.bus;
  }

  /**
   * Publish a payload to every current subscriber of `topic`.
   *
   * Resolves once each subscriber has queued it — not once each has consumed
   * it, which would let one idle client stall the publisher.
   */
  async publish<T>(topic: string, payload: T): Promise<void> {
    await this.bus.emit(topic, payload);
  }

  /** Synchronous publish, for callers that cannot await. */
  publishSync<T>(topic: string, payload: T): void {
    this.bus.emitSync(topic, payload);
  }

  /**
   * Subscribe to one or more topics.
   *
   * The returned iterator runs until `return()` is called on it — which
   * `graphql`'s `subscribe()` does when the client sends `complete` or the
   * socket closes — or until {@link close} ends it.
   */
  subscribe<T = unknown>(topic: string | string[]): AsyncIterableIterator<T> {
    const topics = Array.isArray(topic) ? topic : [topic];
    if (topics.length === 0) {
      throw new Error('PubSub.subscribe() needs at least one topic');
    }

    const queue: T[] = [];
    /** Consumers parked in `next()` waiting for a payload. */
    const pending: Array<{
      resolve: (result: IteratorResult<T>) => void;
      reject: (error: unknown) => void;
    }> = [];
    let done = false;
    let warnedOnce = false;
    /**
     * Set when the subscriber is ended by an overflow. Held rather than thrown,
     * because the overflow happens on the publisher's stack: the next `next()`
     * rejects with it, so the failure surfaces on the consumer instead of
     * vanishing into a quiet completion.
     */
    let failure: unknown;

    const detach = (): void => {
      for (const name of topics) {
        this.bus.off(name, push as any);
        const set = this.subscribers.get(name);
        set?.delete(registration);
        if (set && set.size === 0) this.subscribers.delete(name);
      }
    };

    /** End the iterator. `error` rejects parked consumers instead of completing them. */
    const finish = (error?: unknown): void => {
      if (done) return;
      done = true;
      detach();
      // Queued payloads are discarded: the consumer is gone.
      queue.length = 0;

      if (error && pending.length === 0) {
        // Nobody to hand it to yet — keep it for the next `next()`.
        failure = error;
      }

      while (pending.length > 0) {
        const waiting = pending.shift()!;
        if (error) waiting.reject(error);
        else waiting.resolve({ value: undefined as any, done: true });
      }
    };

    const push = (payload: T): void => {
      if (done) return;

      const waiting = pending.shift();
      if (waiting) {
        waiting.resolve({ value: payload, done: false });
        return;
      }

      if (queue.length >= this.maxQueueSize) {
        if (this.backpressure === 'error') {
          finish(new SubscriberOverflowError(topics.join(', '), this.maxQueueSize));
          return;
        }
        if (!warnedOnce) {
          warnedOnce = true;
          getLogger().warn('GraphQL subscriber fell behind; dropping payloads', {
            topics,
            maxQueueSize: this.maxQueueSize,
            strategy: this.backpressure,
          });
        }
        if (this.backpressure === 'drop-newest') return;
        queue.shift(); // 'drop-oldest'
      }

      queue.push(payload);
    };

    const registration = { end: () => finish() };

    for (const name of topics) {
      this.bus.on(name, push as any);
      const set = this.subscribers.get(name) ?? new Set<{ end: () => void }>();
      set.add(registration);
      this.subscribers.set(name, set);
    }

    const iterator: AsyncIterableIterator<T> = {
      next(): Promise<IteratorResult<T>> {
        if (failure !== undefined) {
          const error = failure;
          failure = undefined; // Reported once; afterwards the iterator is simply done.
          return Promise.reject(error);
        }
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          pending.push({ resolve, reject });
        });
      },

      return(): Promise<IteratorResult<T>> {
        finish();
        return Promise.resolve({ value: undefined as any, done: true });
      },

      throw(error?: unknown): Promise<IteratorResult<T>> {
        finish();
        return Promise.reject(error);
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  }

  /** Alias matching the graphql-subscriptions naming many resolvers expect. */
  asyncIterator<T = unknown>(topic: string | string[]): AsyncIterableIterator<T> {
    return this.subscribe<T>(topic);
  }

  /** Live subscribers on a topic. */
  subscriberCount(topic: string): number {
    return this.subscribers.get(topic)?.size ?? 0;
  }

  /**
   * End every subscriber — on one topic, or on all of them.
   *
   * Call it during shutdown: an open iterator keeps a listener on the bus, and
   * on a shared bus those outlive the application that created them.
   */
  close(topic?: string): void {
    const sets = topic
      ? [this.subscribers.get(topic)].filter(Boolean)
      : Array.from(this.subscribers.values());

    // end() mutates this.subscribers, so iterate over a copy.
    for (const set of sets as Set<{ end: () => void }>[]) {
      for (const registration of Array.from(set)) {
        registration.end();
      }
    }
  }
}

/** Process-wide instance, for apps that do not need more than one. */
export const globalPubSub = new PubSub({ eventBus: globalEvents });
