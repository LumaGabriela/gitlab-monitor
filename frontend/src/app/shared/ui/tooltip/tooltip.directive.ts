import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  InputSignal,
  Renderer2,
} from '@angular/core';

import { nextControlId } from '../field/field-context';

/**
 * Dica (substitui o `#tip` do protótipo, que só funcionava com o mouse): abre no hover e no foco, fecha ao sair,
 * no blur e com Esc, e descreve o alvo por `aria-describedby`. Posição acima do alvo, ou abaixo se não couber.
 */
@Directive({
  selector: '[appTooltip]',
  host: {
    '(mouseenter)': 'show()',
    '(focus)': 'show()',
    '(mouseleave)': 'hide()',
    '(blur)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class TooltipDirective {
  public readonly appTooltip: InputSignal<string> = input.required<string>();

  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderer: Renderer2 = inject(Renderer2);
  private readonly id: string = nextControlId('dica');
  private tip: HTMLElement | null = null;
  /** Descrição que o alvo já tinha (ajuda ou erro do campo): preservada e restaurada. */
  private originalDescribedBy: string | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy((): void => this.hide());
  }

  protected show(): void {
    const texto = this.appTooltip();
    if (this.tip || !texto) return;
    const tip: HTMLElement = this.renderer.createElement('div');
    this.renderer.setAttribute(tip, 'role', 'tooltip');
    this.renderer.setAttribute(tip, 'id', this.id);
    this.renderer.addClass(tip, 'ui-tooltip');
    this.renderer.appendChild(tip, this.renderer.createText(texto));
    this.renderer.appendChild(document.body, tip);
    this.originalDescribedBy = this.host.getAttribute('aria-describedby');
    this.renderer.setAttribute(
      this.host,
      'aria-describedby',
      `${this.originalDescribedBy ?? ''} ${this.id}`.trim(),
    );
    this.tip = tip;
    this.position(tip);
  }

  protected hide(): void {
    if (!this.tip) return;
    this.renderer.removeChild(document.body, this.tip);
    if (this.originalDescribedBy)
      this.renderer.setAttribute(this.host, 'aria-describedby', this.originalDescribedBy);
    else this.renderer.removeAttribute(this.host, 'aria-describedby');
    this.originalDescribedBy = null;
    this.tip = null;
  }

  /** Centraliza acima do alvo; se não couber, abaixo. A distância vem de --spacing-2 (classe .ui-tooltip). */
  private position(tip: HTMLElement): void {
    const alvo = this.host.getBoundingClientRect();
    const caixa = tip.getBoundingClientRect();
    const acima = alvo.top - caixa.height >= 0;
    const esquerda = Math.min(
      Math.max(alvo.left + alvo.width / 2 - caixa.width / 2, 0),
      window.innerWidth - caixa.width,
    );
    this.renderer.addClass(tip, acima ? 'ui-tooltip--above' : 'ui-tooltip--below');
    this.renderer.setStyle(tip, 'left', `${esquerda}px`);
    this.renderer.setStyle(tip, 'top', `${acima ? alvo.top - caixa.height : alvo.bottom}px`);
  }
}
