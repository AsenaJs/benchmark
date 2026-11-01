import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('bench_users')
export class BenchUser {
  @PrimaryColumn({ type: 'integer' })
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
