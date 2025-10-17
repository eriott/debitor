import { BadRequestException, Body, Controller, Headers, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('users/:userId/transactions')
export class TransactionsController {
  constructor (private readonly transactionsService: TransactionsService) {
  }

  @Post()
  async createTransaction (
    @Param('userId', ParseIntPipe) userId: number,
    @Body() createTransactionDto: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.transactionsService.createTransaction(
      userId,
      createTransactionDto,
      idempotencyKey
    );
  }
}
