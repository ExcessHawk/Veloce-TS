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

  async emit<T = unknown>(event: string, payload?: T): Promise<void> {
    const list = this.listeners.get(event) ?? [];
    const toRemove: EventHandler[] = [];
    await Promise.all(
      list.map(async entry => {
        await entry.handler(payload);
        if (entry.once) toRemove.push(entry.handler);
      })
    );
    if (toRemove.length > 0) {
      this.listeners.set(event, list.filter(e => !toRemove.includes(e.handler)));
    }
  }

  emitSync<T = unknown>(event: string, payload?: T): void {
    const list = this.listeners.get(event) ?? [];
    const toRemove: EventHandler[] = [];
    for (const entry of list) {
      entry.handler(payload);
      if (entry.once) toRemove.push(entry.handler);
    }
    if (toRemove.length > 0) {
      this.listeners.set(event, list.filter(e => !toRemove.includes(e.handler)));
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
