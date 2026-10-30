import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import { FileDatabase } from './database.ts';
import { handleApi } from './http.ts';

export function storagePlugin(): Plugin {
  return {
    name: 'inklex-sqlite',
    configureServer(server) {
      const database = new FileDatabase(resolve(process.env.INKLEX_DATA_DIR || 'data'));
      server.middlewares.use((req, res, next) => { void handleApi(req, res, database).then(handled => { if (!handled) next(); }).catch(next); });
      server.httpServer?.once('close', () => database.close());
    },
    configurePreviewServer(server) {
      const database = new FileDatabase(resolve(process.env.INKLEX_DATA_DIR || 'data'));
      server.middlewares.use((req, res, next) => { void handleApi(req, res, database).then(handled => { if (!handled) next(); }).catch(next); });
      server.httpServer.once('close', () => database.close());
    },
  };
}
