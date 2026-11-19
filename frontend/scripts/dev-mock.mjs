#!/usr/bin/env node
// Sobe o mock do monitor e o `ng serve` apontado para ele.
//
// É o que o Playwright usa como webServer: um comando só, nada de GitLab e
// nada de .env. Também serve para mexer na interface sem depender do
// monitor de verdade estar rodando.
import { spawn } from 'node:child_process';

// Portas próprias: a 4200 e as vizinhas costumam ter outros projetos, e a
// 4280/8792 são das jornadas, que reaproveitam servidor já no ar.
const mockPort = process.env['MOCK_PORT'] ?? '8791';
const port = process.env['PORT'] ?? '4290';

const children = [];

function run(command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) stop(code ?? 1);
  });
  return child;
}

function stop(code) {
  for (const child of children) child.kill();
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

run(process.execPath, ['mock/monitor-mock.mjs'], { MOCK_PORT: mockPort });
run('npx', ['ng', 'serve', '--port', port], {
  MONITOR_API: `http://localhost:${mockPort}`,
});
