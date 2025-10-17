import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { validate } from '../src/config/env.validation';
import databaseConfig from '../src/config/database.config';
import { UsersModule } from '../src/users/users.module';
import { TransactionsModule } from '../src/transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const config = configService.get<TypeOrmModuleOptions>('database');
        if (!config) {
          throw new Error('Database configuration not found');
        }
        return config;
      },
      inject: [ConfigService],
    }),
    UsersModule,
    TransactionsModule,
  ],
})
export class TestAppModule {}
