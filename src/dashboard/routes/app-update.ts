import { Hono } from 'hono';
import {
  buildAppUpdateErrorStatus,
  checkAppUpdate,
} from '../../core/app-update.js';

const app = new Hono();

app.get('/api/app-update', async (c) => {
  try {
    return c.json(await checkAppUpdate());
  } catch (err) {
    return c.json(buildAppUpdateErrorStatus(err));
  }
});

export default app;
