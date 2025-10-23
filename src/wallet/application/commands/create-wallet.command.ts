export class CreateWalletCommand {
  constructor(
    public readonly walletId: string,
    public readonly ownerId: string,
    public readonly initialBalance = 0,
  ) {}
}
