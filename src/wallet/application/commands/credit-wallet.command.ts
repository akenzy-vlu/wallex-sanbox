export class CreditWalletCommand {
  constructor(
    public readonly walletId: string,
    public readonly amount: number,
    public readonly description?: string,
  ) {}
}
