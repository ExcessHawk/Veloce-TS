/**
 * `@On('event')` — declarative event listeners.
 *
 * Listed for a long time as "not yet implemented; use globalEvents.on(...)".
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { VeloceTS } from '../src/core/application';
import { On, getEventListeners, hasEventListeners } from '../src/decorators/events';
import { EventBus } from '../src/events/event-bus';
import { Controller, Get } from '../src/decorators/http';
import { Inject } from '../src/decorators/dependencies';

function makeApp(bus: EventBus) {
  return new VeloceTS({ docs: false, eventBus: bus });
}

describe('@On metadata', () => {
  it('records the decorated methods on the class', () => {
    class Listeners {
      @On('a') first() {}
      @On('b', { once: true }) second() {}
    }

    expect(hasEventListeners(Listeners)).toBe(true);
    expect(getEventListeners(Listeners)).toEqual([
      { event: 'a', propertyKey: 'first', once: false },
      { event: 'b', propertyKey: 'second', once: true },
    ]);
  });

  it('reads from the prototype as well as the constructor', () => {
    class Listeners {
      @On('x') handle() {}
    }
    expect(getEventListeners(Listeners.prototype)).toHaveLength(1);
  });

  it('reports nothing for an undecorated class', () => {
    class Plain {}
    expect(hasEventListeners(Plain)).toBe(false);
    expect(getEventListeners(Plain)).toEqual([]);
  });

  it('supports several methods on the same event', () => {
    class Listeners {
      @On('same') a() {}
      @On('same') b() {}
    }
    expect(getEventListeners(Listeners)).toHaveLength(2);
  });
});

describe('@On subscription', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('invokes the method when the event fires', async () => {
    const seen: unknown[] = [];

    class Listeners {
      @On('user.created')
      onCreated(payload: unknown) { seen.push(payload); }
    }

    const app = makeApp(bus);
    app.include(Listeners);
    await app.compile();

    await bus.emit('user.created', { id: 7 });
    expect(seen).toEqual([{ id: 7 }]);
  });

  it('preserves `this`, so the method can use instance state', async () => {
    class Counter {
      count = 0;
      @On('tick') bump() { this.count++; }
    }

    const app = makeApp(bus);
    app.include(Counter);
    await app.compile();

    await bus.emit('tick');
    await bus.emit('tick');

    const instance = await app.getContainer().resolve<Counter>(Counter, { scope: 'singleton' });
    expect(instance.count).toBe(2);
  });

  it('awaits an async listener', async () => {
    let finished = false;

    class Listeners {
      @On('slow')
      async work() {
        await new Promise((r) => setTimeout(r, 20));
        finished = true;
      }
    }

    const app = makeApp(bus);
    app.include(Listeners);
    await app.compile();

    await bus.emit('slow');
    expect(finished).toBe(true);
  });

  it('honours { once: true }', async () => {
    let calls = 0;

    class Listeners {
      @On('boot', { once: true }) ready() { calls++; }
    }

    const app = makeApp(bus);
    app.include(Listeners);
    await app.compile();

    await bus.emit('boot');
    await bus.emit('boot');
    expect(calls).toBe(1);
  });

  it('injects into the listener the same way it does into a controller', async () => {
    class Mailer {
      sent: string[] = [];
      send(to: string) { this.sent.push(to); }
    }

    class Listeners {
      constructor(@Inject(Mailer) private mailer: Mailer) {}
      @On('signup')
      welcome(payload: { email: string }) { this.mailer.send(payload.email); }
    }

    const app = makeApp(bus);
    const mailer = new Mailer();
    app.getContainer().register(Mailer, { factory: () => mailer, scope: 'singleton' });

    app.include(Listeners);
    await app.compile();

    await bus.emit('signup', { email: 'ada@example.com' });
    expect(mailer.sent).toEqual(['ada@example.com']);
  });

  it('lets one class be both a controller and a listener', async () => {
    const seen: string[] = [];

    @Controller('/things')
    class ThingController {
      @Get('/')
      list() { return { ok: true }; }

      @On('thing.changed')
      onChanged() { seen.push('changed'); }
    }

    const app = makeApp(bus);
    app.include(ThingController);
    await app.compile();

    const res = await app.getHono().request('/things');
    expect(res.status).toBe(200);

    await bus.emit('thing.changed');
    expect(seen).toEqual(['changed']);
  });

  it('reports a clear error when @On names something that is not a method', async () => {
    class Broken {
      @On('oops') handler() {}
    }
    // Replace the method with a non-callable after the decorator ran.
    (Broken.prototype as any).handler = 'not a function';

    const app = makeApp(bus);
    app.include(Broken);

    await expect(app.compile()).rejects.toThrow(/is not a method/);
  });

  it('an exception in one listener does not stop the others', async () => {
    const reached: string[] = [];

    class Listeners {
      @On('fanout') bad() { throw new Error('listener exploded'); }
      @On('fanout') good() { reached.push('good'); }
    }

    const app = makeApp(bus);
    app.include(Listeners);
    await app.compile();

    await expect(bus.emit('fanout')).rejects.toThrow();
    expect(reached).toEqual(['good']);
  });
});

describe('@On teardown', () => {
  it('shutdown() detaches the listeners', async () => {
    let calls = 0;
    const bus = new EventBus();

    class Listeners {
      @On('ping') onPing() { calls++; }
    }

    const app = makeApp(bus);
    app.include(Listeners);
    await app.compile();

    await bus.emit('ping');
    expect(calls).toBe(1);

    await app.shutdown();

    await bus.emit('ping');
    // Without teardown, listeners on a shared bus outlive the app that made
    // them, and every app in a suite would answer the same event.
    expect(calls).toBe(1);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('two apps on one bus do not double-handle after the first shuts down', async () => {
    const bus = new EventBus();
    const seen: string[] = [];

    class A { @On('shared') handle() { seen.push('a'); } }
    class B { @On('shared') handle() { seen.push('b'); } }

    const first = makeApp(bus);
    first.include(A);
    await first.compile();

    const second = makeApp(bus);
    second.include(B);
    await second.compile();

    await bus.emit('shared');
    expect(seen.sort()).toEqual(['a', 'b']);

    await first.shutdown();
    seen.length = 0;

    await bus.emit('shared');
    expect(seen).toEqual(['b']);
  });
});
