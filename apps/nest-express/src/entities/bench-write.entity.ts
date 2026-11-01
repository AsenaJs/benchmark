import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('bench_writes')
export class BenchWrite {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  id: number;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  age: number;

  @Column()
  city: string;
}
