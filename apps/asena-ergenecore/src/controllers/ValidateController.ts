import { Controller } from '@asenajs/asena/decorators';
import { Post } from '@asenajs/asena/decorators/http';
import { type Context } from '@asenajs/ergenecore';
import { BenchUserValidator, type BenchUserDto } from '../validators/BenchUserValidator';

@Controller('/validate')
export class ValidateController {
  @Post({ path: '/user', validator: BenchUserValidator })
  public async user(context: Context) {
    const dto = await context.getBody<BenchUserDto>();

    return context.send(
      {
        ok: true,
        name: dto.name,
        email: dto.email,
        age: dto.age,
        tagCount: dto.tags.length,
        city: dto.address.city,
      },
      200,
    );
  }
}
