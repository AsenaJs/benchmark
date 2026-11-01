import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const benchUsers = pgTable('bench_users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  age: integer('age').notNull(),
  city: text('city').notNull(),
});

export const benchWrites = pgTable('bench_writes', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  age: integer('age').notNull(),
  city: text('city').notNull(),
});
