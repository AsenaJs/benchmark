import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { DbService, type WriteBody } from './db.service';

@Controller('/db')
export class DbController {
  constructor(private readonly db: DbService) {}

  @Get('user/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.db.findUser(Number(id));
    if (!user) throw new NotFoundException({ error: 'not_found' });
    return user;
  }

  @Get('users')
  async listUsers(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const items = await this.db.listUsers(
      Math.min(Number(limit ?? 20) || 20, 100),
      Number(offset ?? 0) || 0,
    );
    return { count: items.length, items };
  }

  @Post('user')
  @HttpCode(HttpStatus.CREATED)
  async createUser(@Body() body: WriteBody) {
    const id = await this.db.createUser(body);
    return { id, created: true };
  }
}
