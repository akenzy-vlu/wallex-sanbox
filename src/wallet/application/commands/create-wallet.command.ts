export class CreateWalletCommand {
  constructor(
    public readonly walletId: string,
    public readonly ownerId: string,
    public readonly initialBalance = 0,
    public readonly idempotencyKey?: string,
    public readonly correlationId?: string,
  ) {}
}
