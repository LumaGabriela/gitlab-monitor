import { InjectionToken, Signal } from '@angular/core';

/**
 * O que um controle precisa saber do campo que o envolve para ficar
 * acessível: o id que o <label for> aponta, os ids da ajuda e do erro para o
 * aria-describedby, e se está inválido ou obrigatório.
 *
 * Vem por injeção, e não por input, para que `<app-field><app-select/></app-field>`
 * funcione sem o pai repassar nada — e para que um controle fora de um campo
 * continue válido (o token é opcional).
 */
export interface FieldContext {
  readonly controlId: string;
  readonly describedBy: Signal<string | null>;
  readonly invalid: Signal<boolean>;
  readonly required: Signal<boolean>;
}

export const FIELD_CONTEXT: InjectionToken<FieldContext> = new InjectionToken<FieldContext>(
  'FIELD_CONTEXT',
);

let sequence = 0;

/** Id único e estável por instância, para rótulo e descrição. */
export function nextControlId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}
