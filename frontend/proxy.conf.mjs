// Para onde o `ng serve` encaminha as rotas do monitor.
//
// Em uso normal é o `make web` desta raiz, em 127.0.0.1:8765. Os testes de
// jornada apontam MONITOR_API para o mock, para não dependerem de um GitLab
// de verdade nem do seu .env.
const target = process.env['MONITOR_API'] ?? 'http://127.0.0.1:8765';

// `/settings` é, ao mesmo tempo, a rota da API (POST) e a página de
// configurações do painel. Só o POST é da API: um GET é navegação ou recarga
// da página, e quem a serve é o próprio `ng serve` (o Python faz o mesmo com
// `page_fallback`).
const pageAndApi = {
  '/settings': {
    target,
    secure: false,
    bypass: (request) => (request.method === 'GET' ? '/index.html' : undefined),
  },
};

export default {
  ...['/data', '/projects', '/refresh', '/preferences'].reduce(
    (config, route) => ({ ...config, [route]: { target, secure: false } }),
    {},
  ),
  ...pageAndApi,
};
