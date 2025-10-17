import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TransactionAction {
  DEBIT = 'DEBIT',
}

@Entity('transaction_history')
@Index(['userId'])
@Index(['idempotencyKey'], { unique: true })
export class TransactionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({
    type: 'enum',
    enum: TransactionAction
  })
  action: TransactionAction;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: string) => value,
      from: (value: string) => value
    }
  })
  amount: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    unique: true
  })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'ts' })
  ts: Date;

  @ManyToOne(() => User, (user) => user.transactions)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
