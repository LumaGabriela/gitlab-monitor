import { TranslateService } from '@ngx-translate/core';

/**
 * O texto de uma chave no idioma de quem olha, ou `fallback` quando a chave
 * não existe no catálogo (ou ele ainda não chegou): o rótulo do backend
 * aparece, nunca a chave crua. Mesma regra do `columnLabel()`.
 *
 * Quem chama precisa ler o sinal de idioma antes, porque o catálogo chega
 * por HTTP depois da primeira renderização.
 */
export function translatedOr(
  translate: TranslateService,
  key: string,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  const traduzido = String(translate.instant(key, params));
  return traduzido === key ? fallback : traduzido;
}
