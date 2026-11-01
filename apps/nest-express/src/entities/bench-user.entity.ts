import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('bench_users')
export class BenchUser {
  @PrimaryColumn()
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
