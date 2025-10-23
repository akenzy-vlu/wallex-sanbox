import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  WalletReadRepository,
  WalletReadModel,
} from '../../../infrastructure/read-model/wallet-read.repository';
import { GetWalletQuery } from '../get-wallet.query';

@QueryHandler(GetWalletQuery)
export class GetWalletHandler
  implements IQueryHandler<GetWalletQuery, WalletReadModel | null>
{
  constructor(private readonly repository: WalletReadRepository) {}

  execute(query: GetWalletQuery): Promise<WalletReadModel | null> {
    return this.repository.findById(query.walletId);
  }
}
