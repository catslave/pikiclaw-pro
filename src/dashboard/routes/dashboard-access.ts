import { Hono } from 'hono';
import {
  dashboardAccessStatus,
  currentDashboardDeviceId,
  listDashboardAccess,
  revokeDashboardDevice,
} from '../dashboard-access-store.js';

const app = new Hono();

app.get('/api/dashboard/access', (c) => {
  const currentDeviceId = currentDashboardDeviceId(c.req.header('cookie'));
  const status = dashboardAccessStatus({
    host: c.req.header('host'),
    protocol: c.req.header('x-forwarded-proto'),
  });
  return c.json({ ok: true, ...listDashboardAccess(currentDeviceId, 30, status) });
});

app.post('/api/dashboard/access/devices/:id/revoke', (c) => {
  const id = c.req.param('id');
  const currentDeviceId = currentDashboardDeviceId(c.req.header('cookie'));
  const revoked = revokeDashboardDevice(id, currentDeviceId);
  return c.json({ ok: revoked, revoked });
});

export default app;
