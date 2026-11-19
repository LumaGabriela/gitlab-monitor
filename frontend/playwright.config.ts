import { defineConfig, devices } from '@playwright/test';

// Portas próprias, longe da 4200 e da 8765: a suíte nunca deve esbarrar num
// `ng serve` ou num `make web` que já estejam abertos na máquina — nem
// reaproveitar um deles por engano, que é o que `reuseExistingServer` faria.
const port = Number(process.env['E2E_PORT'] ?? 4280);
const mockPort = process.env['E2E_MOCK_PORT'] ?? '8792';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  // Desde que cada seção das configurações virou rota `loadComponent` (ADR
  // 0004), entrar numa delas pela primeira vez inclui buscar o chunk — e no
  // `ng serve` ele ainda é compilado sob demanda. O roteador só troca a URL
  // depois disso, então o orçamento padrão de 5 s do `expect` passou a medir
  // a máquina, e não a tela: com a suíte em paralelo e a máquina ocupada, a
  // navegação estourava e o teste falhava sem nada de errado no app.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  // As jornadas rodam em 1280 e em 375 px: é onde a barra de filtros troca
  // de uma linha para uma coluna, e onde a tabela passa a rolar.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: 'node scripts/dev-mock.mjs',
    url: `http://localhost:${port}`,
    env: { PORT: String(port), MOCK_PORT: mockPort },
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
  },
});
