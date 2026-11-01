import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('/validate')
export class ValidateController {
  @Post('user')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  validateUser(@Body() dto: CreateUserDto) {
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
