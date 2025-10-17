import { IsEnum, IsString, Matches } from 'class-validator';
import { TransactionAction } from '../entities/transaction-history.entity';

export class CreateTransactionDto {
  @IsEnum(TransactionAction)
  action: TransactionAction;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a valid decimal string with up to 2 decimal places (e.g., "10.50")'
  })
  @Matches(/^(?!0+(\.0{1,2})?$)\d+(\.\d{1,2})?$/, {
    message: 'amount must be greater than zero'
  })
  amount: string;
}
