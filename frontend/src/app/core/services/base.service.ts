import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEndpointName, apiEndpoint } from '../api/api-endpoints';

/**
 * Base dos serviços que falam HTTP. Toda chamada passa por aqui, então o
 * endereço vem sempre do catálogo (nunca um literal espalhado) e há um único
 * lugar para acrescentar cabeçalho, repetição ou log.
 *
 * É uma versão enxuta do BaseService do fpf-metrics-web: este backend não
 * tem autenticação, paginação nem upload, e carregar os métodos que cuidam
 * disso seria copiar contrato que não existe deste lado.
 */
export abstract class BaseService {
  protected readonly http: HttpClient = inject(HttpClient);

  protected url(name: ApiEndpointName): string {
    return apiEndpoint(name);
  }

  protected async get<T>(name: ApiEndpointName, params?: HttpParams): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.url(name), { params }));
  }

  protected async post<T>(name: ApiEndpointName, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(name), body));
  }
}
