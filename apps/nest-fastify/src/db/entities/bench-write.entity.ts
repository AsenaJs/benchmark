import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bench_writes')
export class BenchWrite {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'integer' })
  age: number;

  @Column({ type: 'text' })
  city: string;
}
