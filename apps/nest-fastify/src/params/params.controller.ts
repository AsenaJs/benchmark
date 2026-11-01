import { Controller, Get, Param } from '@nestjs/common';

@Controller('/params')
export class ParamsController {
  @Get(':id/items/:itemId')
  getParams(@Param('id') id: string, @Param('itemId') itemId: string) {
    const numericId = Number(id);
    const numericItemId = Number(itemId);
    return { id: numericId, itemId: numericItemId, sum: numericId + numericItemId };
  }
}
