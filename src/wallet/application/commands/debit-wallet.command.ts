export class DebitWalletCommand {
  constructor(
    public readonly walletId: string,
    public readonly amount: number,
    public readonly description?: string,
  ) {}
}
