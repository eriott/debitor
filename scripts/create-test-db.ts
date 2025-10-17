import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

async function createTestDatabase () {
  const testDbName = process.env.DB_DATABASE;

  const connection = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: 'postgres'
  });

  try {
    await connection.initialize();
    console.log('Connected to PostgreSQL');

    // Check if test database exists
    const result = await connection.query(
      `SELECT 1
       FROM pg_database
       WHERE datname = $1`,
      [testDbName]
    );

    if (result.length === 0) {
      await connection.query(`CREATE DATABASE ${testDbName}`);
      console.log(`✓ Test database "${testDbName}" created`);
    } else {
      console.log(`✓ Test database "${testDbName}" already exists`);
    }

    await connection.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Error creating test database:', error);
    process.exit(1);
  }
}

createTestDatabase();
