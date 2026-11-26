import { Directive, InputSignal, TemplateRef, inject, input } from '@angular/core';

/** Contexto do template de célula: a linha em `$implicit`. */
export interface CellContext<T> {
  readonly $implicit: T;
}

/**
 * Template próprio para uma coluna da tabela (selos, links, listas):
 * `<ng-template appCellDef="pipeline" let-row>…</ng-template>`.
 */
@Directive({ selector: 'ng-template[appCellDef]' })
export class CellDefDirective {
  public readonly appCellDef: InputSignal<string> = input.required<string>();
  public readonly template: TemplateRef<CellContext<unknown>> =
    inject<TemplateRef<CellContext<unknown>>>(TemplateRef);
}
