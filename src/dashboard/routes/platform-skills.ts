import { Hono } from 'hono';
import { listPlatformSkills } from '../../platform/skills.js';

const app = new Hono();

app.get('/api/platform-skills/catalog', (c) => {
  return c.json({ ok: true, skills: listPlatformSkills() });
});

export default app;
