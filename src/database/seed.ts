import { User } from '../users/entities/user.entity';
import { DataSource } from 'typeorm'
import { getDataSourceConfig } from '../config/database.config'

async function seed () {
  try {
    const dataSource = new DataSource(getDataSourceConfig())
    await dataSource.initialize();
    console.log('Database connection initialized');

    const userRepository = dataSource.getRepository(User);

    const existingUser = await userRepository.findOne({ where: { id: 1 } });

    if (existingUser) {
      console.log('User with id=1 already exists. Skipping seed.');
      console.log(`Current balance: ${existingUser.balance}`);
    } else {
      const user = userRepository.create({
        id: 1,
        balance: '1000.00'
      });

      await userRepository.save(user);
      console.log('User with id=1 created successfully');
      console.log(`Initial balance: ${user.balance}`);
    }

    await dataSource.destroy();
    console.log('Seed completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during seed:', error);
    process.exit(1);
  }
}

seed();
