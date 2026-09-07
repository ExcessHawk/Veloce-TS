/**
 * PubSub — the async-iterable source behind GraphQL subscriptions.
 */
import { describe, it, expect } from 'bun:test';
import { PubSub, SubscriberOverflowError } from '../src/graphql/pubsub';
import { EventBus } from '../src/events/event-bus';
import { On, getEventListeners } from '../src/decorators/events';

/** Collect `count` payloads, failing rather than hanging if they never arrive. */
async function take<T>(iterator: AsyncIterableIterator<T>, count: number, ms = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for payload ${i + 1}/${count}`)), ms)
      ),
    ]);
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe('PubSub delivery', () => {
  it('delivers a payload published after the consumer parked in next()', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe<{ id: number }>('USER_CREATED');

    const pending = stream.next();
    await pubsub.publish('USER_CREATED', { id: 1 });

    expect((await pending).value).toEqual({ id: 1 });
  });

  it('queues payloads published before the consumer asks for them', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe<number>('TICK');

    await pubsub.publish('TICK', 1);
    await pubsub.publish('TICK', 2);
    await pubsub.publish('TICK', 3);

    expect(await take(stream, 3)).toEqual([1, 2, 3]);
  });

  it('fans out to every subscriber of a topic', async () => {
    const pubsub = new PubSub();
    const a = pubsub.subscribe<string>('NEWS');
    const b = pubsub.subscribe<string>('NEWS');

    await pubsub.publish('NEWS', 'hello');

    expect((await a.next()).value).toBe('hello');
    expect((await b.next()).value).toBe('hello');
  });

  it('delivers nothing for a topic nobody published to', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe('A');
    await pubsub.publish('B', 1);

    const raced = await Promise.race([
      stream.next().then(() => 'delivered'),
      new Promise(r => setTimeout(() => r('quiet'), 50)),
    ]);
    expect(raced).toBe('quiet');
  });

  it('subscribes to several topics at once', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe<string>(['A', 'B']);

    await pubsub.publish('A', 'from-a');
    await pubsub.publish('B', 'from-b');

    expect(await take(stream, 2)).toEqual(['from-a', 'from-b']);
  });

  it('rejects a subscription with no topics', () => {
    expect(() => new PubSub().subscribe([])).toThrow(/at least one topic/);
  });

  it('works as a for-await source', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe<number>('N');
    const seen: number[] = [];

    const consumer = (async () => {
      for await (const value of stream) {
        seen.push(value);
        if (seen.length === 2) break;
      }
    })();

    await pubsub.publish('N', 1);
    await pubsub.publish('N', 2);
    await consumer;

    expect(seen).toEqual([1, 2]);
  });
});

describe('PubSub teardown', () => {
  it('return() detaches the bus listener', async () => {
    const bus = new EventBus();
    const pubsub = new PubSub({ eventBus: bus });

    const stream = pubsub.subscribe('T');
    expect(bus.listenerCount('T')).toBe(1);
    expect(pubsub.subscriberCount('T')).toBe(1);

    await stream.return!();

    expect(bus.listenerCount('T')).toBe(0);
    expect(pubsub.subscriberCount('T')).toBe(0);
  });

  it('a completed iterator keeps reporting done', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe('T');

    await stream.return!();
    expect((await stream.next()).done).toBe(true);
    expect((await stream.next()).done).toBe(true);
  });

  it('a payload published after return() is not delivered', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe('T');

    await stream.return!();
    await pubsub.publish('T', 'late');

    expect((await stream.next()).done).toBe(true);
  });

  it('releases a consumer parked in next() when the iterator ends', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe('T');

    const pending = stream.next();
    await stream.return!();

    expect((await pending).done).toBe(true);
  });

  it('close(topic) ends every subscriber of that topic only', async () => {
    const pubsub = new PubSub();
    const closed = pubsub.subscribe('A');
    const kept = pubsub.subscribe('B');

    pubsub.close('A');

    expect((await closed.next()).done).toBe(true);
    expect(pubsub.subscriberCount('A')).toBe(0);
    expect(pubsub.subscriberCount('B')).toBe(1);

    await pubsub.publish('B', 'still-here');
    expect((await kept.next()).value).toBe('still-here');
  });

  it('close() with no topic ends all of them', async () => {
    const bus = new EventBus();
    const pubsub = new PubSub({ eventBus: bus });
    const a = pubsub.subscribe('A');
    const b = pubsub.subscribe('B');

    pubsub.close();

    expect((await a.next()).done).toBe(true);
    expect((await b.next()).done).toBe(true);
    // Every listener detached — nothing left leaking on a shared bus.
    expect(bus.listenerCount('A')).toBe(0);
    expect(bus.listenerCount('B')).toBe(0);
  });
});

describe('PubSub backpressure', () => {
  it('drop-oldest keeps the newest payloads', async () => {
    const pubsub = new PubSub({ maxQueueSize: 3, backpressure: 'drop-oldest' });
    const stream = pubsub.subscribe<number>('T');

    for (let i = 1; i <= 5; i++) await pubsub.publish('T', i);

    expect(await take(stream, 3)).toEqual([3, 4, 5]);
  });

  it('drop-newest keeps the oldest payloads', async () => {
    const pubsub = new PubSub({ maxQueueSize: 3, backpressure: 'drop-newest' });
    const stream = pubsub.subscribe<number>('T');

    for (let i = 1; i <= 5; i++) await pubsub.publish('T', i);

    expect(await take(stream, 3)).toEqual([1, 2, 3]);
  });

  it('error ends the subscriber that fell behind', async () => {
    const pubsub = new PubSub({ maxQueueSize: 2, backpressure: 'error' });
    const stream = pubsub.subscribe<number>('T');

    for (let i = 1; i <= 3; i++) await pubsub.publish('T', i);

    // The overflow rejects the parked consumer; a later next() just reports done.
    await expect(
      (async () => {
        for await (const _ of stream) { /* drain */ }
      })()
    ).rejects.toBeInstanceOf(SubscriberOverflowError);
  });

  it('a slow subscriber does not block a fast one', async () => {
    const pubsub = new PubSub({ maxQueueSize: 2, backpressure: 'drop-oldest' });
    const slow = pubsub.subscribe<number>('T');
    const fast = pubsub.subscribe<number>('T');

    for (let i = 1; i <= 5; i++) {
      await pubsub.publish('T', i);
      await fast.next();
    }

    // The fast one saw everything; the slow one only kept its last two.
    expect(await take(slow, 2)).toEqual([4, 5]);
  });
});

describe('PubSub bus sharing', () => {
  it('two instances with private buses do not see each other', async () => {
    const a = new PubSub();
    const b = new PubSub();
    const stream = b.subscribe('T');

    await a.publish('T', 'from-a');

    const raced = await Promise.race([
      stream.next().then(() => 'delivered'),
      new Promise(r => setTimeout(() => r('quiet'), 50)),
    ]);
    expect(raced).toBe('quiet');
  });

  it('a shared bus reaches both a subscription and an @On listener', async () => {
    const bus = new EventBus();
    const pubsub = new PubSub({ eventBus: bus });
    const seen: unknown[] = [];

    class Listeners {
      @On('ORDER_PLACED') record(payload: unknown) { seen.push(payload); }
    }
    // Subscribe the @On method by hand — this test is about the shared bus,
    // not about the application wiring.
    const instance = new Listeners();
    for (const meta of getEventListeners(Listeners)) {
      bus.on(meta.event, (payload: unknown) => (instance as any)[meta.propertyKey](payload));
    }

    const stream = pubsub.subscribe('ORDER_PLACED');
    await pubsub.publish('ORDER_PLACED', { id: 'o1' });

    expect((await stream.next()).value).toEqual({ id: 'o1' });
    expect(seen).toEqual([{ id: 'o1' }]);
  });

  it('publishSync delivers without awaiting', async () => {
    const pubsub = new PubSub();
    const stream = pubsub.subscribe<string>('T');

    pubsub.publishSync('T', 'now');

    expect((await stream.next()).value).toBe('now');
  });
});
