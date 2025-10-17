import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import {
  TransactionHistory,
  TransactionAction,
} from '../src/transactions/entities/transaction-history.entity';

describe('Transactions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let testUser: User;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = moduleFixture.get<DataSource>(DataSource);
  });

  const getServer = () => app.getHttpServer();

  beforeEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clean up database (delete child records first to avoid FK constraint violation)
    await dataSource
      .createQueryBuilder()
      .delete()
      .from(TransactionHistory)
      .execute();
    await dataSource.createQueryBuilder().delete().from(User).execute();

    const userRepo = dataSource.getRepository(User);
    testUser = await userRepo.save(userRepo.create({ balance: '1000.00' }));
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /users/:userId/transactions', () => {
    describe('Golden Path - Successful Debit', () => {
      it('should successfully debit user balance', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'test-debit-1')
          .send({
            action: 'DEBIT',
            amount: '100',
          })
          .expect(201);

        expect(response.body).toMatchObject({
          id: expect.any(String),
          userId: testUser.id,
          action: 'DEBIT',
          amount: '100',
          idempotencyKey: 'test-debit-1',
          ts: expect.any(String),
        });

        // Verify user balance updated correctly
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('900.00');
      });

      it('should create transaction history record with correct fields', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'test-history-1')
          .send({
            action: 'DEBIT',
            amount: '250',
          })
          .expect(201);

        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          userId: testUser.id,
          action: TransactionAction.DEBIT,
          amount: '250.00',
          idempotencyKey: 'test-history-1',
        });
        expect(history[0].ts).toBeInstanceOf(Date);
      });
    });

    describe('Idempotency - Duplicate Request Handling', () => {
      it('should return existing transaction for duplicate idempotency key', async () => {
        const idempotencyKey = 'test-idempotent-1';
        const payload = {
          action: 'DEBIT',
          amount: '100',
        };

        // First request
        const response1 = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', idempotencyKey)
          .send(payload)
          .expect(201);

        // Second request with same idempotency key (simulating retry)
        const response2 = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', idempotencyKey)
          .send(payload)
          .expect(201);

        // Should return exact same transaction
        expect(response1.body.id).toBe(response2.body.id);
        expect(response1.body.ts).toBe(response2.body.ts);

        // Balance should only be deducted once
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('900.00');

        // Should only have one transaction in history
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(1);
      });

      it('should handle race condition with concurrent identical requests', async () => {
        const idempotencyKey = 'test-race-condition-1';
        const payload = {
          action: 'DEBIT',
          amount: '50',
        };

        // Send 5 concurrent requests with same idempotency key
        const promises = Array(5)
          .fill(null)
          .map(() =>
            request(getServer())
              .post(`/users/${testUser.id}/transactions`)
              .set('idempotency-key', idempotencyKey)
              .send(payload),
          );

        const responses = await Promise.all(promises);

        // All should succeed (status 201)
        responses.forEach((res) => expect(res.status).toBe(201));

        // All should return same transaction ID
        const transactionIds = responses.map((r) => r.body.id);
        const uniqueIds = new Set(transactionIds);
        expect(uniqueIds.size).toBe(1);

        // Balance should only be deducted once
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('950.00');

        // Should only have one transaction in history
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(1);
      });

      it('should handle different transactions with different idempotency keys', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'key-1')
          .send({ action: 'DEBIT', amount: '100' })
          .expect(201);

        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'key-2')
          .send({ action: 'DEBIT', amount: '50' })
          .expect(201);

        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(2);

        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('850.00'); // 1000 - 100 - 50
      });
    });

    describe('Concurrent Transactions - Race Conditions', () => {
      it('should handle multiple concurrent DEBIT transactions correctly', async () => {
        // Create 10 concurrent transactions with different idempotency keys
        const promises = Array(10)
          .fill(null)
          .map((_, i) =>
            request(getServer())
              .post(`/users/${testUser.id}/transactions`)
              .set('idempotency-key', `concurrent-debit-${i}`)
              .send({
                action: 'DEBIT',
                amount: '10',
              }),
          );

        const responses = await Promise.all(promises);

        // All should succeed
        responses.forEach((res) => expect(res.status).toBe(201));

        // Final balance should be 1000 - (10 * 10) = 900
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('900.00');

        // Should have 10 transactions
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(10);
      });

      it('should prevent double-spending with concurrent high-value requests', async () => {
        // User has 1000, try to spend 600 twice concurrently
        const promises = [
          request(getServer())
            .post(`/users/${testUser.id}/transactions`)
            .set('idempotency-key', 'double-spend-1')
            .send({ action: 'DEBIT', amount: '600' }),

          request(getServer())
            .post(`/users/${testUser.id}/transactions`)
            .set('idempotency-key', 'double-spend-2')
            .send({ action: 'DEBIT', amount: '600' }),
        ];

        const responses = await Promise.all(promises);

        // One should succeed (201), one should fail with insufficient funds (400)
        const statuses = responses.map((r) => r.status).sort();
        expect(statuses).toEqual([201, 409]);

        const successResponse = responses.find((r) => r.status === 201);
        const failResponse = responses.find((r) => r.status === 409);

        expect(failResponse.body.message).toContain('Insufficient funds');

        // Balance should be 400 (only one transaction succeeded)
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('400.00');

        // Only one transaction should be recorded
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(1);
      });

      it('should handle many concurrent small transactions', async () => {
        // 10 concurrent transactions of 10 each
        const promises = Array(10)
          .fill(null)
          .map((_, i) =>
            request(getServer())
              .post(`/users/${testUser.id}/transactions`)
              .set('idempotency-key', `small-tx-${i}`)
              .send({ action: 'DEBIT', amount: '10' }),
          );

        const responses = await Promise.all(promises);

        // All should succeed
        responses.forEach((res) => expect(res.status).toBe(201));

        // Balance: 1000 - (10 * 10) = 900
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('900.00');
      });
    });

    describe('Error Handling', () => {
      it('should return 409 for insufficient funds', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'insufficient-funds-1')
          .send({
            action: 'DEBIT',
            amount: '2000', // More than available balance
          })
          .expect(409);

        expect(response.body.message).toContain('Insufficient funds');

        // Balance should not change
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('1000.00');

        // No transaction should be created
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find();
        expect(history).toHaveLength(0);
      });

      it('should return 409 for exact balance + 1', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'exact-plus-one')
          .send({
            action: 'DEBIT',
            amount: '1001',
          })
          .expect(409);

        expect(response.body.message).toContain('Insufficient funds');
      });

      it('should allow debit for exact balance amount', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'exact-balance')
          .send({
            action: 'DEBIT',
            amount: '1000',
          })
          .expect(201);

        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('0.00');
      });

      it('should return 404 for non-existent user', async () => {
        const response = await request(getServer())
          .post('/users/99999/transactions')
          .set('idempotency-key', 'nonexistent-user-1')
          .send({
            action: 'DEBIT',
            amount: '100',
          })
          .expect(404);

        expect(response.body.message).toContain('User with id 99999 not found');
      });

      it('should return 400 when idempotency-key header is missing', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .send({
            action: 'DEBIT',
            amount: '100',
          })
          .expect(400);

        expect(response.body.message).toContain(
          'Idempotency-Key header is required',
        );
      });
    });

    describe('Validation', () => {
      it('should return 400 for invalid action', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'invalid-action-1')
          .send({
            action: 'INVALID',
            amount: '100',
          })
          .expect(400);

        const message = Array.isArray(response.body.message)
          ? response.body.message.join(' ')
          : response.body.message;
        expect(message).toContain('action');
      });

      it('should return 400 for CREDIT action (not supported)', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'credit-not-supported')
          .send({
            action: 'CREDIT',
            amount: '100',
          })
          .expect(400);
      });

      it('should return 400 for negative amount', async () => {
        const response = await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'negative-amount-1')
          .send({
            action: 'DEBIT',
            amount: '-100',
          })
          .expect(400);

        const message = Array.isArray(response.body.message)
          ? response.body.message.join(' ')
          : response.body.message;
        expect(message).toContain('amount');
      });

      it('should return 400 for zero amount', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'zero-amount-1')
          .send({
            action: 'DEBIT',
            amount: '0',
          })
          .expect(400);
      });

      it('should return 400 for missing action', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'missing-action-1')
          .send({
            amount: '100',
          })
          .expect(400);
      });

      it('should return 400 for missing amount', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'missing-amount-1')
          .send({
            action: 'DEBIT',
          })
          .expect(400);
      });

      it('should reject extra fields when forbidNonWhitelisted is enabled', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'extra-field-1')
          .send({
            action: 'DEBIT',
            amount: '100',
            extraField: 'should be rejected',
            hacker: 'attempt',
          })
          .expect(400);
      });
    });

    describe('Balance Consistency', () => {
      it('should maintain correct balance after multiple sequential operations', async () => {
        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'seq-1')
          .send({ action: 'DEBIT', amount: '100' })
          .expect(201);

        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'seq-2')
          .send({ action: 'DEBIT', amount: '200' })
          .expect(201);

        await request(getServer())
          .post(`/users/${testUser.id}/transactions`)
          .set('idempotency-key', 'seq-3')
          .send({ action: 'DEBIT', amount: '150' })
          .expect(201);

        // Final balance: 1000 - 100 - 200 - 150 = 550
        const user = await dataSource
          .getRepository(User)
          .findOne({ where: { id: testUser.id } });
        expect(user.balance).toBe('550.00');

        // Verify transaction count
        const history = await dataSource
          .getRepository(TransactionHistory)
          .find({
            order: { ts: 'ASC' },
          });

        expect(history).toHaveLength(3);
      });
    });
  });
});
