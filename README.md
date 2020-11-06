# RxWire
RxWire is a small library that makes it simple to communicate RxJS Observables over any channel. 

Below are a few code examples:

### Creating a RxWire instance

The `RxWire` constructor takes one argument: an object that implements the `Wire` interface.

Below is a sample generator function that creates a `RxWire` instance from a provided `Socket` object from Socket.io:

```typescript
import { RxWire } from 'rxwire';
import { Socket } from 'socket.io';

/**
 * Creates an RxWire instance that communicates observables over a socket.io connection
 * @param socket the socket to manage
 */
export function RxWireFromSocket(socket: Socket): RxWire {
    return new RxWire({
		on: <T>(event: string, handler: (data: T) => void): void => {
            socket.on(event, handler);
		},
		once: <T>(event: string, handler: (data: T) => void): void => {
            socket.once(event, handler);
		},
		off: <T>(event: string, handler: ((...args: any[]) => void)): void => {
			socket.off(event, handler);
		},
		emit: <T>(event: string, data?: T): void => {
            socket.emit(event, data);
		}
	});
}
```

### Example #1 - Registering observables

To allow an observable to be observed across the wire, they must be **registered**. Below is a demonstration of how to register an observable:

```typescript
import { RxWire } from 'rxwire';
import { interval } from 'rxjs';

// First, create an RxWire instance
const wire: RxWire = RxWireFromSocket(some_socket);

// Next, register two observables
wire.register('every-second', interval(1000));
wire.register('every-two-seconds', interval(2000));

// NOTE: Nothing will happen until the peer on the other side of the wire subscribes to one of these registered observables by name ('every-second' or 'every-two-seconds').
```

### Example #2 - Subscribing to observables

To subscribe to an observable registered by the peer on the other side of the wire, it's equally simple:

```typescript
import { RxWire } from 'rxwire';

// First, create the RxWire for the client
const wire: RxWire = RxWireFromSocket(some_socket);

// Observe one of the observables registered
wire.observe$('every-second')
    .subscribe(() => console.log('Beep!'));
```

### Registering and observing

Each side of the wire can both register *and* observe events.

### Contributing

My goal is to keep this project extremely small. If you find a bug, please submit an Issue.
