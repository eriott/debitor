import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { TransactionHistory } from './entities/transaction-history.entity';
import { User } from '../users/entities/user.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY_MS = 50;

  constructor (
    @InjectRepository(TransactionHistory) private transactionHistoryRepository: Repository<TransactionHistory>,
    @InjectRepository(User) private userRepository: Repository<User>,
    private dataSource: DataSource
  ) {
  }

  async createTransaction (
    userId: number,
    dto: CreateTransactionDto,
    idempotencyKey: string
  ): Promise<TransactionHistory> {
    return this.executeWithRetry(() =>
      this.processTransaction(userId, dto, idempotencyKey)
    );
  }

  private async executeWithRetry<T> (
    operation: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.isRetryableError(error) && attempt < this.MAX_RETRIES) {
        this.logger.warn(`Retrying after serialization failure (attempt ${attempt}/${this.MAX_RETRIES})`);
        // Exponential backoff with jitter to avoid thundering herd
        const baseDelay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter = Math.random() * baseDelay * 0.5;
        await this.delay(baseDelay + jitter);
        return this.executeWithRetry(operation, attempt + 1);
      }
      throw error;
    }
  }

  private isRetryableError (error: any): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const pgError = error as any;
    const code = pgError.code;
    const message = pgError.message || '';

    // PostgreSQL error codes:
    // 40001 - serialization_failure
    // 40P01 - deadlock_detected
    return (
      code === '40001' ||
      code === '40P01' ||
      message.includes('could not serialize access due to concurrent update') ||
      message.includes('could not serialize access due to read/write dependencies')
    );
  }

  private isIdempotencyError (error: any): boolean {
    return error.code === '23505' &&
      (error.constraint?.includes('idempotency') ||
        error.detail?.includes('idempotency_key'))
  }

  private async processTransaction (
    userId: number,
    dto: CreateTransactionDto,
    idempotencyKey: string
  ): Promise<TransactionHistory> {
    const userExists = await this.userRepository.exists({ where: { id: userId } });
    if (!userExists) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    try {
      return await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager) => {
          const updateResult = await manager
            .createQueryBuilder()
            .update(User)
            .set({ balance: () => 'balance - CAST(:amount AS NUMERIC)' })
            .where('id = :userId AND balance >= CAST(:amount AS NUMERIC)', { userId, amount: dto.amount })
            .execute();

          if (updateResult.affected === 0) {
            throw new ConflictException('Insufficient funds');
          }

          const transaction = manager.create(TransactionHistory, {
            userId,
            action: dto.action,
            amount: dto.amount,
            idempotencyKey
          });

          const saved = await manager.save(TransactionHistory, transaction);
          this.logger.log(`Transaction ${saved.id} completed. User ${userId}, action: ${dto.action}`);
          return saved;
        }
      );
    } catch (error) {
      // Handle unique constraint violation for idempotency key
      if (error instanceof QueryFailedError) {
        const pgError = error as any;

        if (this.isIdempotencyError(pgError)) {
          this.logger.log(`Duplicate idempotency key ${idempotencyKey}, returning existing transaction`);

          const existing = await this.transactionHistoryRepository.findOne({ where: { idempotencyKey } });
          if (!existing) {
            this.logger.error(`Race condition: duplicate key but transaction not found for ${idempotencyKey}`);
            throw new ConflictException('Duplicate transaction detected but not found in database');
          }

          return existing;
        }
      }

      throw error;
    }
  }

  private delay (ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
