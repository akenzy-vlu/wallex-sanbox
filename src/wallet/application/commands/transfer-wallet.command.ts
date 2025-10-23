export class TransferWalletCommand {
  constructor(
    public readonly fromWalletId: string,
    public readonly toWalletId: string,
    public readonly amount: number,
    public readonly description?: string,
  ) {}
}
