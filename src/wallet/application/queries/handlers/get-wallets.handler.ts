import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  WalletReadModel,
  WalletReadRepository,
} from '../../../infrastructure/read-model/wallet-read.repository';
import { GetWalletsQuery } from '../get-wallets.query';

@QueryHandler(GetWalletsQuery)
export class GetWalletsHandler
  implements IQueryHandler<GetWalletsQuery, WalletReadModel[]>
{
  constructor(private readonly repository: WalletReadRepository) {}

  execute(): Promise<WalletReadModel[]> {
    return this.repository.findAll();
  }
}
