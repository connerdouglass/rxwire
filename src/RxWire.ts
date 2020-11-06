import { fromEventPattern, merge, Observable, Subject } from 'rxjs';
import { filter, flatMap, map, mapTo, scan, share, shareReplay, take, takeUntil } from 'rxjs/operators';

enum RxWireEventNames {
    SUBSCRIBE = 'rxwire.observable.subscribe',
    UNSUBSCRIBE = 'rxwire.observable.unsubscribe',
    NEXT = 'rxwire.observable.next',
    ERROR = 'rxwire.observable.error',
    COMPLETE = 'rxwire.observable.complete'
}

export interface Wire {
    on<T>(event: string, handler: (data: T) => void): void | ((...args: any[]) => void);
    once<T>(event: string, handler: (data: T) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    emit<T>(event: string, data?: T): void;
}

interface IWireEvent_Next<T> {
    handle: string;
    value: T;
}

interface IWireEvent_Error {
    handle: string;
    error?: any;
}

interface IWireEvent_Complete {
    handle: string;
}

interface IWireEvent_Subscribe {
    event: string;
    handle: string;
}

interface IWireEvent_Unsubscribe {
    event: string;
    handle: string;
}

interface IRegisteredEvent<T> {
    event: string;
    obs$: Observable<T>;
}

export class RxWire {

    /**
     * Subject emitted when the wire is disconnected
     */
    public readonly disconnected$: Subject<void> = new Subject<void>();

    /**
     * Subject emitted when events are registered
     */
    private readonly register_event$: Subject<IRegisteredEvent<any>> = new Subject<IRegisteredEvent<any>>();

    /**
     * Subject emitted when events are deregistered
     */
    private readonly deregister_event$: Subject<string> = new Subject<string>();

    /**
     * Subject emitted when a new event has been registered
     */
    private readonly registered_events$: Observable<IRegisteredEvent<any>[]> = merge(
            this.register_event$.pipe(map(reg_event => ({action: 'register', reg_event } as const))),
            this.deregister_event$.pipe(map(event => ({action: 'deregister', event } as const))),
        )
        .pipe(scan((all: IRegisteredEvent<any>[], change: {action: 'register'; reg_event: IRegisteredEvent<any>} | {action: 'deregister'; event: string }) => {
            if (change.action === 'register') return [ ...all, change.reg_event ];
            if (change.action === 'deregister') return all.filter(reg_event => reg_event.event !== change.event);
            return all;
        }, [] as IRegisteredEvent<any>[]))
        .pipe(shareReplay(1));

    /**
     * Observable of inbound subscriptions
     */
    private readonly inbound_subscribe$: Observable<IWireEvent_Subscribe> = fromEventPattern<IWireEvent_Subscribe>(
            h => this.wire.on(RxWireEventNames.SUBSCRIBE, h),
            h => this.wire.off(RxWireEventNames.SUBSCRIBE, h)
        )
        .pipe(share());

    /**
     * Observable of the inbound unsubscribe events
     */
    private readonly inbound_unsubscribe$: Observable<IWireEvent_Unsubscribe> = fromEventPattern<IWireEvent_Unsubscribe>(
            h => this.wire.on(RxWireEventNames.UNSUBSCRIBE, h),
            h => this.wire.off(RxWireEventNames.UNSUBSCRIBE, h)
        )
        .pipe(share());

    /**
     * Observable that emits whenever a subscription and a registration have been matches
     */
    private readonly matchmaker$: Observable<{reg_event: IRegisteredEvent<any>; sub_event: IWireEvent_Subscribe;}> = this.inbound_subscribe$
        .pipe(flatMap(sub_event =>
            merge(
                    this.registered_events$
                        .pipe(take(1))
                        .pipe(map(reg_events => reg_events.find(re => re.event === sub_event.event)))
                        .pipe(filter((reg_event): reg_event is IRegisteredEvent<any> => !!reg_event)),
                    this.register_event$
                        .pipe(takeUntil(this.on_event_deregistered$(sub_event.event)))
                        .pipe(takeUntil(
                            this.inbound_unsubscribe$.pipe(filter(unsub_event => unsub_event.handle === sub_event.handle))
                        ))
                        .pipe(filter(reg_event => reg_event.event === sub_event.event))
                )
                .pipe(map(reg_event => ({ reg_event, sub_event })))
        ));

    /**
     * Creates an observable that emits when an event has been deregistered
     * @param event the event name to watch
     */
    private on_event_deregistered$(event: string): Observable<void> {
        return merge(
                this.disconnected$,
                this.deregister_event$.pipe(filter(dereg_event => event === dereg_event))
            )
            .pipe(mapTo(undefined));
    }

    public constructor(
        private wire: Wire) {

        this.registered_events$
            .pipe(takeUntil(this.disconnected$))
            .subscribe();

        this.matchmaker$
            .pipe(takeUntil(this.disconnected$))
            .subscribe(({ reg_event, sub_event }) => {

                // Subscribe to the registered observable
                reg_event.obs$
                    .pipe(takeUntil(this.on_event_deregistered$(sub_event.event)))
                    .pipe(takeUntil(
                        this.inbound_unsubscribe$.pipe(filter(unsub_event => unsub_event.handle === sub_event.handle))
                    ))
                    .subscribe({
                        next: (value: any) => this.wire.emit<IWireEvent_Next<any>>(RxWireEventNames.NEXT, {
                            handle: sub_event.handle,
                            value
                        }),
                        error: (error?: any) => this.wire.emit<IWireEvent_Error>(RxWireEventNames.ERROR, {
                            handle: sub_event.handle,
                            error
                        }),
                        complete: () => this.wire.emit<IWireEvent_Complete>(RxWireEventNames.COMPLETE, {
                            handle: sub_event.handle
                        })
                    });

            });

    }

    /**
     * Gets an observable to a remove observable with the provided event name
     * @param event the event name to observe
     */
    public observe$<T>(event: string): Observable<T> {
        return new Observable<T>(sub => {

            // Create a handle for the event
            const handle: string = `rxwire-${event}-${Date.now()}`;

            // Create the handler for the 'next' values
            const next_handler = (event: IWireEvent_Next<T>) => {
                if (event.handle !== handle) return;
                sub.next(event.value);
            };

            // Create the handler for the errors
            const error_handler = (event: IWireEvent_Error) => {
                if (event.handle !== handle) return;
                sub.error(event.error);
            };

            // Create the handler for the 'complete' event
            const complete_handler = (event: IWireEvent_Complete) => {
                if (event.handle !== handle) return;
                sub.complete();
            };

            // Add the handler for next values
            const next_h = this.wire.on(RxWireEventNames.NEXT, next_handler) || next_handler;
            const error_h = this.wire.on(RxWireEventNames.ERROR, error_handler) || error_handler;
            const complete_h = this.wire.on(RxWireEventNames.COMPLETE, complete_handler) || complete_handler;

            // Subscribe to the event
            this.wire.emit(RxWireEventNames.SUBSCRIBE, <IWireEvent_Subscribe>{
                handle,
                event
            });

            // Return a completion handler
            return () => {

                // Emit an unsubscribe event
                this.wire.emit(RxWireEventNames.UNSUBSCRIBE, <IWireEvent_Unsubscribe>{
                    handle,
                    event
                });

                // Remove the handlers
                this.wire.off(RxWireEventNames.NEXT, next_h);
                this.wire.off(RxWireEventNames.ERROR, error_h);
                this.wire.off(RxWireEventNames.COMPLETE, complete_h);

            };

        });
    }

    /**
     * Registers an event to the wire as a named observable
     * @param event the event name
     * @param obs the observable to register
     */
    public register<T>(event: string, obs$: Observable<T>): void {
        this.register_event$.next({ event, obs$ });
    }

    /**
     * Deregisters an event from the wire manager
     * @param event the event name to deregister
     */
    public deregister(event: string): void {
        this.deregister_event$.next(event);
    }

}
