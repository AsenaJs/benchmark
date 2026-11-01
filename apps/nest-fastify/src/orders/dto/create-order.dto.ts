export interface OrderItemDto {
  sku: string;
  qty: number;
  priceCents: number;
}

export interface CreateOrderDto {
  customer: { id: number; name: string; email: string };
  items: OrderItemDto[];
  note?: string;
}
