import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
const result = spawnSync(process.execPath, ['node_modules/rollup/dist/bin/rollup', '-c'], {
    stdio: 'inherit', env: { ...process.env, SERVE: 'false' }
});
if (result.error || result.status !== 0) process.exit(result.status || 1);
mkdirSync('dist', { recursive: true });
copyFileSync('package.json', 'dist/package.json');
