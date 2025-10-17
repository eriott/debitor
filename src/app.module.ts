import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from './config/env.validation';
import databaseConfig from './config/database.config';
import { UsersModule } from './users/users.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [databaseConfig]
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
              }
            }
            : undefined,
        level: process.env.LOG_LEVEL || 'info',
        genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
        customAttributeKeys: {
          reqId: 'requestId'
        }
      }
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
      inject: [ConfigService]
    }),
    UsersModule,
    TransactionsModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {
}
