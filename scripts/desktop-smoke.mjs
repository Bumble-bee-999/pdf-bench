/** Boots the packaged shell under a virtual display and checks it renders. */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shot = join(root, 'test', 'shot-desktop.png');
if (existsSync(shot)) rmSync(shot);

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron');
const args = ['-a', electron, '.', '--no-sandbox'];
const child = spawn('xvfb-run', args, {
  cwd: root,
  env: { ...process.env, PDFBENCH_SMOKE: shot, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});

let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });

child.on('exit', (code) => {
  const ok = existsSync(shot) && statSync(shot).size > 10000;
  console.log(`\nexit code ${code}`);
  console.log(ok ? `desktop shell renders ✓ (${(statSync(shot).size / 1024).toFixed(0)} KB screenshot)` : 'desktop shell FAILED to render');
  const blocked = [...out.matchAll(/\[blocked outbound request\] (\S+)/g)].map((m) => m[1]);
  console.log(blocked.length ? `blocked ${blocked.length} outbound request(s): ${blocked.slice(0, 3).join(', ')}` : 'no outbound requests were attempted');
  process.exit(ok ? 0 : 1);
});
