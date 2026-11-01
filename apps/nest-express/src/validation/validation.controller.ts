import { Body, Controller, HttpCode, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('validate')
export class ValidationController {
  @Post('user')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  validateUser(@Body() dto: CreateUserDto): {
    ok: boolean;
    name: string;
    email: string;
    age: number;
    tagCount: number;
    city: string;
  } {
    return {
      ok: true,
      name: dto.name,
      email: dto.email,
      age: dto.age,
      tagCount: dto.tags.length,
      city: dto.address.city,
    };
  }
}
