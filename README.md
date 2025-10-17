# Balance Transaction Service

Web server для управления балансом пользователей с поддержкой атомарных транзакций.

## Реализовано

- Списание баланса пользователя через `POST /users/:userId/transactions`
- Таблицы: `users` (id, balance), `transaction_history` (user_id, action, amount, ts)
- Идемпотентность через `Idempotency-Key` header
- Обработка race conditions (SERIALIZABLE isolation + retry logic)
- Валидация запросов (class-validator)
- E2E тесты

## Запуск

```bash
npm ci
cp .env.example .env
npm run seed # Создание начального пользователя
npm run start:dev
```

## Тесты
 
Нужно изменить файл `.env.test`, указав там тестовую базу (переменная DB_DATABASE)

```bash
cp .env.example .env.test 
npm run test:e2e
```
