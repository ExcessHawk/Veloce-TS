const SSE_KEY    = 'veloce:sse';
const STREAM_KEY = 'veloce:stream';

export function SSE(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SSE_KEY, true, target, propertyKey as string);
  };
}

export function Stream(contentType = 'application/octet-stream'): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(STREAM_KEY, contentType, target, propertyKey as string);
  };
}

export function isSSE(target: any, propertyKey: string): boolean {
  return Reflect.getMetadata(SSE_KEY, target.prototype ?? target, propertyKey) === true;
}

export function getStreamContentType(target: any, propertyKey: string): string | undefined {
  return Reflect.getMetadata(STREAM_KEY, target.prototype ?? target, propertyKey);
}
