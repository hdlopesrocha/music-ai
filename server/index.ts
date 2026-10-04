import { createServer } from 'node:http'
import { describeConfig } from './config.js'
import { createRuntime } from './container.js'
import { handleNodeRequest } from './nodeAdapter.js'

try {
  process.loadEnvFile()
} catch {
  // .env is optional; configuration can be supplied via the environment.
}

const runtime = createRuntime()
runtime.logger.info('starting submission API', describeConfig(runtime.config))

const server = createServer((req, res) => {
  void handleNodeRequest(runtime.app, req, res, runtime.config.maxUploadSize)
})

server.listen(runtime.config.port, runtime.config.host, () => {
  runtime.logger.info('submission API listening', {
    host: runtime.config.host,
    port: runtime.config.port,
  })
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    runtime.logger.info('shutting down', { signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  })
}
