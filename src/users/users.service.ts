import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor (
    @InjectRepository(User)
    private userRepository: Repository<User>
  ) {
  }

  async getBalance (userId: number): Promise<{ balance: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    return { balance: user.balance };
  }
}
