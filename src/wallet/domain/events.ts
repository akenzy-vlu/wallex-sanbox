export type WalletEventType =
  | 'WalletCreated'
  | 'WalletCredited'
  | 'WalletDebited';

export interface EventMetadata {
  readonly version: number;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface WalletEventBase<TType extends WalletEventType, TData> {
  readonly type: TType;
  readonly aggregateId: string;
  readonly data: TData;
}

export interface WalletCreatedEvent
  extends WalletEventBase<
    'WalletCreated',
    { ownerId: string; initialBalance?: number }
  > {}

export interface WalletCreditedEvent
  extends WalletEventBase<
    'WalletCredited',
    { amount: number; description?: string }
  > {}

export interface WalletDebitedEvent
  extends WalletEventBase<
    'WalletDebited',
    { amount: number; description?: string }
  > {}

type WithMetadata<T extends WalletEventBase<WalletEventType, any>> = T & {
  readonly metadata: EventMetadata;
};

export type WalletDomainEvent =
  | WalletCreatedEvent
  | WalletCreditedEvent
  | WalletDebitedEvent;

export type StoredWalletEvent =
  | WithMetadata<WalletCreatedEvent>
  | WithMetadata<WalletCreditedEvent>
  | WithMetadata<WalletDebitedEvent>;
