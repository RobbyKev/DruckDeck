import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// Nur im Dev-Server: erlaubt den automatischen Tests, erzeugte PDFs in ./test-output abzulegen.
function devSavePdf() {
  return {
    name: 'dev-save-pdf',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save', (req, res) => {
        if (req.method !== 'POST') return res.end();
        const name = basename(new URL(req.url, 'http://x').searchParams.get('name') || 'out.pdf');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(server.config.root, 'test-output');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [devSavePdf()],
  server: { host: '127.0.0.1', port: 5173 },
});
