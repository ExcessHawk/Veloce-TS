type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

interface EventEntry<T = unknown> {
  handler: EventHandler<T>;
  once: boolean;
}

export class EventBus {
  private listeners = new Map<string, Array<EventEntry>>();

  on<T = unknown>(event: string, handler: EventHandler<T>): this {
    const list = this.listeners.get(event) ?? [];
    list.push({ handler: handler as EventHandler, once: false });
    this.listeners.set(event, list);
    return this;
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): this {
    const list = this.listeners.get(event) ?? [];
    list.push({ handler: handler as EventHandler, once: true });
    this.listeners.set(event, list);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter(e => e.handler !== handler));
    return this;
  }

  /**
   * Invoke all listeners concurrently. A throwing listener does not prevent
   * the others from running; collected errors are rethrown as AggregateError
   * after every listener has settled. `once` listeners are removed even when
   * they throw.
   */
  async emit<T = unknown>(event: string, payload?: T): Promise<void> {
    const list = this.listeners.get(event) ?? [];
    const toRemove: EventHandler[] = [];
    const results = await Promise.allSettled(
      list.map(async entry => {
        try {
          await entry.handler(payload);
        } finally {
          if (entry.once) toRemove.push(entry.handler);
        }
      })
    );
    if (toRemove.length > 0) {
      this.listeners.set(event, list.filter(e => !toRemove.includes(e.handler)));
    }
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} listener(s) failed for event "${event}"`);
    }
  }

  emitSync<T = unknown>(event: string, payload?: T): void {
    const list = this.listeners.get(event) ?? [];
    const toRemove: EventHandler[] = [];
    const errors: unknown[] = [];
    for (const entry of list) {
      try {
        entry.handler(payload);
      } catch (err) {
        errors.push(err);
      } finally {
        if (entry.once) toRemove.push(entry.handler);
      }
    }
    if (toRemove.length > 0) {
      this.listeners.set(event, list.filter(e => !toRemove.includes(e.handler)));
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} listener(s) failed for event "${event}"`);
    }
  }

  listenerCount(event: string): number {
    return (this.listeners.get(event) ?? []).length;
  }

  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return this;
  }
}

export const globalEvents = new EventBus();
