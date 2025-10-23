export class WalletDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletDomainError';
  }
}

export class WalletAlreadyExistsError extends WalletDomainError {
  constructor(walletId: string) {
    super(`Wallet ${walletId} already exists`);
    this.name = 'WalletAlreadyExistsError';
  }
}

export class WalletNotFoundError extends WalletDomainError {
  constructor(walletId: string) {
    super(`Wallet ${walletId} was not found`);
    this.name = 'WalletNotFoundError';
  }
}

export class InsufficientFundsError extends WalletDomainError {
  constructor(walletId: string, balance: number, amount: number) {
    super(
      `Wallet ${walletId} has insufficient funds: balance ${balance}, attempted debit ${amount}`,
    );
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidAmountError extends WalletDomainError {
  constructor(amount: number) {
    super(`Amount must be greater than zero. Received: ${amount}`);
    this.name = 'InvalidAmountError';
  }
}

export class EventConcurrencyError extends WalletDomainError {
  constructor(expectedVersion: number, currentVersion: number) {
    super(
      `Concurrency conflict detected. Expected version ${expectedVersion}, actual ${currentVersion}`,
    );
    this.name = 'EventConcurrencyError';
  }
}
