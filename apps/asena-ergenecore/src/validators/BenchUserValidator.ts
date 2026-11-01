import { Middleware } from '@asenajs/asena/decorators';
import { ValidationService } from '@asenajs/ergenecore';
import { z } from 'zod';

const benchUserSchema = z.object({
  name: z.string().min(3).max(50),
  email: z.email(),
  age: z.number().int().min(18).max(120),
  tags: z.array(z.string()).min(1).max(10),
  address: z.object({
    city: z.string().min(1),
    zip: z.string().min(3),
  }),
});

export type BenchUserDto = z.infer<typeof benchUserSchema>;

export interface NewBenchUserDto {
  name: string;
  email: string;
  age: number;
  city: string;
}

/** Validates the JSON body of POST /validate/user. */
@Middleware({ validator: true })
export class BenchUserValidator extends ValidationService {
  public json() {
    return benchUserSchema;
  }
}
