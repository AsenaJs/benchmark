import express from 'express';
import { createUser, findUser, listUsers } from '../db';

const router = express.Router();

router.get('/user/:id', async (req, res) => {
  const user = await findUser(Number(req.params.id));
  if (!user) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(user);
});

router.get('/users', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
  const offset = Number(req.query.offset ?? 0) || 0;
  const items = await listUsers(limit, offset);
  res.json({ count: items.length, items });
});

router.post('/user', express.json(), async (req, res) => {
  const user = req.body as { name: string; email: string; age: number; city: string };
  const id = await createUser(user);
  res.status(201).json({ id, created: true });
});

export default router;
