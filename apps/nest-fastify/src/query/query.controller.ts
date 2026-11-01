import { Controller, Get, Query } from '@nestjs/common';

@Controller('/query')
export class QueryController {
  @Get()
  getQuery(@Query() query: Record<string, string | undefined>) {
    const name = query.name ?? 'anonymous';
    const page = Number(query.page ?? 1) || 1;
    const size = Number(query.size ?? 10) || 10;
    const sort = query.sort ?? 'asc';
    return { name, page, size, sort, offset: (page - 1) * size };
  }
}
