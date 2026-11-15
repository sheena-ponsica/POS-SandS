import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createApp } from './server/app.ts';
import { ensureDatabaseReady } from './server/accounting.ts';

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const app = createApp();
  const httpServer = createHttpServer(app);

  // Warm database initialization without blocking immediate port binding
  ensureDatabaseReady().catch((err) => {
    console.error('Initial database bootstrap error:', err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        },
        appType: 'spa',
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Sheena & Shelo's Business POS running on http://0.0.0.0:${PORT}`);
    });
    await vitePromise;
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Sheena & Shelo's Business POS running on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
