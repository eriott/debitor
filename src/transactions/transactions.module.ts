import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { TransactionHistory } from './entities/transaction-history.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionHistory, User])],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService]
})
export class TransactionsModule {
}
