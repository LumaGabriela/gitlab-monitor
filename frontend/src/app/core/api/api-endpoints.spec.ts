import { API_ENDPOINTS, apiEndpoint } from './api-endpoints';

describe('catálogo de endpoints', () => {
  it('toda rota do catálogo começa com barra', () => {
    for (const [name, path] of Object.entries(API_ENDPOINTS)) {
      expect(path.startsWith('/'), name).toBe(true);
    }
  });

  it('apiEndpoint devolve a rota do catálogo', () => {
    expect(apiEndpoint('panelData')).toBe(API_ENDPOINTS.panelData);
  });

  it('o painel só consome as cinco rotas do monitor', () => {
    // Rota nova entra pelo catálogo, e aqui, antes de aparecer num serviço.
    expect(Object.keys(API_ENDPOINTS).sort()).toEqual([
      'panelData',
      'panelPreferences',
      'panelRefresh',
      'panelSettings',
      'panelTargets',
    ]);
  });
});
