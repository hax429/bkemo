import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routerExpress/auth';
import { configureSession } from './routerExpress/auth/config';

import { ArchiveJob } from './jobs/archivejob';
import { BackupJob } from './jobs/backupJob';
import { WeeklyKnowledgeJob } from './jobs/weeklyKnowledgeJob';
import { stopAllScheduleTimers } from './jobs/baseScheduleJob';
import { registerBackgroundJobLifecycle } from './lib/jobLifecycle';
import { resumeAttachmentMigrationJobs } from './lib/attachmentStorageMigration';
import { resumeLinkEnrichmentJobs } from './lib/linkEnrichment/service';
import { isDatabaseWriteLocked, recoverInterruptedDatabaseMigrationJobs } from './lib/databaseMigration';
import { staticCacheControl } from './lib/staticCache';

// tRPC related imports
import { createContext } from './context';
import { appRouter } from './routerTrpc/_app';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';

// API documentation
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './swagger';

// Express router imports
import fileRouter from './routerExpress/file/file';
import uploadRouter from './routerExpress/file/upload';
import deleteRouter from './routerExpress/file/delete';
import s3fileRouter from './routerExpress/file/s3file';
import attachmentRouter from './routerExpress/file/attachment';
import pluginRouter from './routerExpress/file/plugin';
import rssRouter from './routerExpress/rss';
import openaiRouter from './routerExpress/openai';
import mcpRouter from './routerExpress/mcp';
import obsidianRouter from './routerExpress/obsidian';
import { noteSyncRouter } from './routerExpress/noteSync';

// Vite integration
import ViteExpress from 'vite-express';

// Process error handling
process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('unhandledRejection:', reason);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await stopAllScheduleTimers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await stopAllScheduleTimers();
  process.exit(0);
});

process.on('exit', (code) => {
  console.log(`process exit, code: ${code}`);
});

/**
 * Initialize all scheduled jobs
 * Timers run in-process and perform no database polling between due times.
 */
async function initializeJobs() {
  try {
    console.log('Initializing low-cost scheduled jobs...');
    await ArchiveJob.initialize();
    await BackupJob.initialize();
    await WeeklyKnowledgeJob.initialize();
    await resumeAttachmentMigrationJobs();
    await resumeLinkEnrichmentJobs();
    console.log('All scheduled jobs initialized successfully');
  } catch (error) {
    console.error('Failed to initialize scheduled jobs:', error);
    // Don't throw - allow server to start even if jobs fail to initialize
  }
}

registerBackgroundJobLifecycle({ start: initializeJobs, pause: stopAllScheduleTimers });

// Server configuration
const app = express();
const PORT = 1111;
const appRootDev = path.resolve(__dirname, '../app');
const appRootProd = path.resolve(__dirname, '../server');
let server: any = null;

if (process.env.NODE_ENV === 'production') {
  // Vite configuration
  ViteExpress.config({
    mode: 'production',
    inlineViteConfig: {
      //docker production dir /dist not development dir
      root: appRootProd,
      build: { outDir: "public" }
    }
  });
} else {
  ViteExpress.config({
    viteConfigFile: path.resolve(appRootDev, 'vite.config.ts'),
    inlineViteConfig: {
      root: appRootDev,
    }
  });
}

// Global error handler
const errorHandler = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('express error:', err);
  res.status(500).json({
    error: {
      message: 'Internal Server Error',
      ...(process.env.NODE_ENV !== 'production' ? { details: err.message, stack: err.stack } : {})
    }
  });
};

/**
 * Setup all API routes for the application
 */
async function setupApiRoutes(app: express.Application) {
  // Authentication routes
  app.use('/api/auth', authRoutes);

  // tRPC endpoint with adapter for Express
  app.use('/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => {
        return createContext(req, res);
      },
      onError: ({ error }) => {
        console.error('tRPC error:', error);
      }
    })
  );

  // File handling endpoints
  app.use('/api/file', fileRouter);
  app.use('/api/file/upload', uploadRouter);
  app.use('/api/file/delete', deleteRouter);
  app.use('/api/s3file', s3fileRouter);
  app.use('/api/attachment', attachmentRouter);
  app.use('/api/v1/obsidian', obsidianRouter);
  app.use('/plugins', pluginRouter);

  // Other API endpoints
  app.use('/api/rss', rssRouter);
  app.use('/v1', openaiRouter);

  // OpenAPI documentation endpoints
  app.get('/api/openapi.json', (req, res) => {
    res.json(openApiDocument);
  });

  // Swagger UI configuration
  app.use('/api-doc', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Blinko API Document',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true
    }
  }));

  // Human-readable API reference (Redoc) — a clean docs webpage rendered from the
  // live OpenAPI spec, served alongside the API for users to read.
  app.get('/docs', (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html>
  <head>
    <title>bkemo API reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet" />
    <style>body { margin: 0; padding: 0; background: #16171a; }</style>
  </head>
  <body>
    <div id="redoc"></div>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
    <script>
      Redoc.init('/api/openapi.json', {
        scrollYOffset: 0,
        hideDownloadButton: false,
        expandResponses: '200,201',
        theme: {
          colors: { primary: { main: '#e2a96b' } },
          typography: {
            fontFamily: 'Inter, system-ui, sans-serif',
            headings: { fontFamily: 'Inter, system-ui, sans-serif' },
            code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
          }
        }
      }, document.getElementById('redoc'));
    </script>
  </body>
</html>`);
  });

  // SSE must be registered before the catch-all OpenAPI middleware.
  app.use(noteSyncRouter);

  // OpenAPI integration
  app.use('/api',
    // @ts-ignore
    createOpenApiExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }: { req: express.Request; res: express.Response }) => {
        return createContext(req, res);
      }
    })
  );
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });


  app.use('/', mcpRouter);
}

/**
 * Bootstrap the server
 * Sets up middleware, auth, API routes and starts the server
 */
async function bootstrap() {
  try {
    app.use(cors({
      origin: true,
      credentials: true
    }));

    if (process.env.TRUST_PROXY === '1') {
      app.set('trust proxy', 1);
    }

    const publicPath = path.resolve(appRootProd, 'public');
    const staticOptions = {
      maxAge: 0,
      immutable: false,
      setHeaders: (res: express.Response, filePath: string) => {
        res.setHeader('Cache-Control', staticCacheControl(filePath, publicPath));
      }
    };

    app.use(express.static(publicPath, staticOptions));

    // Add body parsers for JSON and form data
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // tRPC knows whether a request is a read or write and applies its own gate.
    // Other HTTP mutation endpoints are blocked here during the final snapshot.
    app.use(async (req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/trpc')) return next();
      if (await isDatabaseWriteLocked()) {
        return res.status(503).json({ error: 'Site is read-only while the PostgreSQL migration is being verified' });
      }
      return next();
    });

    await configureSession(app);

    // Setup API routes
    await setupApiRoutes(app);
    //@ts-ignore
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      errorHandler(err, req, res, next);
    });

    // Interrupted one-time copies cannot resume because credentials are never
    // persisted. Recover them before deciding whether background writes may run.
    await recoverInterruptedDatabaseMigrationJobs();
    const attachedDevelopmentNeon = process.env.NODE_ENV !== 'production' && process.env.BKEMO_DEV_ATTACHED_NEON === 'true';
    if (!await isDatabaseWriteLocked() && !attachedDevelopmentNeon) await initializeJobs();
    else if (attachedDevelopmentNeon) console.log('Existing Neon development database attached: background jobs are disabled locally');
    else console.log('Database cutover ready: background jobs remain paused until restart on the target');

    // Start or update server
    if (!server) {
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`🎉server start on port http://0.0.0.0:${PORT} - env: ${process.env.NODE_ENV || 'development'}`);
      });
      
      // Increase timeout for large file uploads (5 minutes)
      server.timeout = 5 * 60 * 1000;
      server.keepAliveTimeout = 5 * 60 * 1000;
      server.headersTimeout = 5 * 60 * 1000;
      
      ViteExpress.bind(app, server); // the server binds to all network interfaces
    } else {
      console.log(`API routes updated - env: ${process.env.NODE_ENV || 'development'}`);
    }
  } catch (err) {
    console.error('start server error:', err);
    try {
      // Attempt to start server even if route setup fails
      if (!server) {
        const server = app.listen(PORT, "0.0.0.0", () => {
          console.log(`🎉server start on port http://0.0.0.0:${PORT} - env: ${process.env.NODE_ENV || 'development'}`);
        });
        ViteExpress.bind(app, server); // the server binds to all network interfaces
      }
    } catch (startupError) {
      console.error('start server error:', startupError);
    }
  }
}

// Start the server
bootstrap(); 
