import { Service } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { BenchUserRepository } from '../repositories/BenchUserRepository';
import { BenchWriteRepository } from '../repositories/BenchWriteRepository';
import type { BenchUser } from './BenchUserService';
import type { NewBenchUserDto } from '../validators/BenchUserValidator';

/** Same queries as BenchUserService, routed through Drizzle so the delta is pure ORM cost. */
@Service('BenchUserOrmService')
export class BenchUserOrmService {
  @Inject(BenchUserRepository)
  private benchUserRepository!: BenchUserRepository;

  @Inject(BenchWriteRepository)
  private benchWriteRepository!: BenchWriteRepository;

  public getById(id: number): Promise<BenchUser | null> {
    return this.benchUserRepository.findRowById(id);
  }

  public getPage(limit: number, offset: number): Promise<BenchUser[]> {
    return this.benchUserRepository.findPage(limit, offset);
  }

  public create(dto: NewBenchUserDto): Promise<number> {
    return this.benchWriteRepository.insertRow(dto);
  }
}
