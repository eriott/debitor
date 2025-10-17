import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { TransactionHistory } from '../transactions/entities/transaction-history.entity';

const makeBaseConfig: () => DataSourceOptions = () => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [User, TransactionHistory],
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development'
});

export const getTypeOrmConfig = (): TypeOrmModuleOptions => makeBaseConfig();

export const getDataSourceConfig = (): DataSourceOptions => makeBaseConfig();

export default registerAs('database', getTypeOrmConfig);
