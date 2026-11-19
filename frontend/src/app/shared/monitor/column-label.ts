import { TranslateService } from '@ngx-translate/core';
import { ColumnModel } from '../../core/models/api/panel-api.model';

/**
 * O nome da coluna no idioma de quem olha.
 *
 * O backend é dono do contrato da tabela (`REPORT_COLUMNS`) e manda o rótulo
 * dele em pt-BR, que é o que o terminal imprime. Na web o painel tem idioma
 * próprio, então o rótulo traduzido vence — e, quando a coluna não tem
 * tradução (uma coluna nova no gitlab_monitor.py, por exemplo), o rótulo do
 * backend aparece em vez da chave crua.
 *
 * Quem chama precisa ler o sinal de idioma antes, porque o catálogo chega
 * por HTTP depois da primeira renderização.
 */
export function columnLabel(translate: TranslateService, column: ColumnModel): string {
  const chave = `columns.${column.key}`;
  const traduzido = String(translate.instant(chave));
  return traduzido === chave ? column.label : traduzido;
}
