import express from 'express';
import { z } from 'zod';

const userSchema = z.object({
  name: z.string().min(3).max(50),
  email: z.email(),
  age: z.number().int().min(18).max(120),
  tags: z.array(z.string()).min(1).max(10),
  address: z.object({ city: z.string().min(1), zip: z.string().min(3) }),
});

const router = express.Router();

router.post('/user', express.json(), (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_failed' });
    return;
  }
  const data = parsed.data;
  res.json({
    ok: true,
    name: data.name,
    email: data.email,
    age: data.age,
    tagCount: data.tags.length,
    city: data.address.city,
  });
});

export default router;
