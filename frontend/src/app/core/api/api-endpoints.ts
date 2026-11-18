import catalog from './api-endpoints.json';

/**
 * Catálogo único dos endereços da API. Nenhum literal de rota pode aparecer
 * fora daqui: com um lugar só, uma rota renomeada no gitlab_monitor.py é uma
 * linha a mudar, e dá para listar o que a tela consome sem ler componente
 * por componente.
 */
export type ApiEndpointName = keyof typeof catalog;

export const API_ENDPOINTS: Readonly<Record<ApiEndpointName, string>> = catalog;

export function apiEndpoint(name: ApiEndpointName): string {
  return API_ENDPOINTS[name];
}
