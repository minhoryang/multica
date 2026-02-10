import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/agent/index.ts',
    'src/hub/index.ts',
    'src/channels/index.ts',
    'src/cron/index.ts',
    'src/heartbeat/index.ts',
    'src/media/index.ts',
    'src/client/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  external: [
    // Native/problematic deps
    'chokidar',
    'fsevents',
    // Node built-ins
    /^node:/,
  ],
})
