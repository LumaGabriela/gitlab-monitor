import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
  Signal,
  viewChild,
} from '@angular/core';

import { FocusTrap } from '../../ui/overlay/focus-trap';

/**
 * Gaveta lateral modal (PLANO-COMPONENTES.md D5): usada abaixo de `md` para a navegação.
 * Ao abrir, o foco entra; Tab fica preso dentro; Esc e o fundo fecham; o foco volta a quem abriu.
 */
@Component({
  selector: 'app-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="ui-drawer">
        <div class="ui-drawer__backdrop" aria-hidden="true" (click)="close()"></div>
        <div
          #panel
          class="ui-drawer__panel"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.aria-label]="label()"
          (keydown.escape)="close()"
          (keydown.tab)="trap($event)"
        >
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class DrawerComponent {
  public readonly open: ModelSignal<boolean> = model<boolean>(false);
  public readonly label: InputSignal<string> = input.required<string>();
  public readonly closed: OutputEmitterRef<void> = output<void>();

  private readonly panel: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('panel');
  private readonly focusTrap: FocusTrap = new FocusTrap();

  public constructor() {
    // Abre: prende o foco. Fecha por qualquer caminho (Esc, fundo, ou o pai pondo open=false): solta e devolve.
    effect((): void => {
      const panel = this.panel()?.nativeElement;
      if (panel) this.focusTrap.activate(panel);
      else if (this.focusTrap.active) this.finish();
    });
    inject(DestroyRef).onDestroy((): void => this.focusTrap.release());
  }

  public close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.finish();
  }

  private finish(): void {
    if (!this.focusTrap.active) return;
    this.focusTrap.release();
    this.closed.emit();
  }

  /** Mantém o Tab circulando entre os elementos focáveis da gaveta. */
  protected trap(event: Event): void {
    const panel = this.panel()?.nativeElement;
    if (panel && event instanceof KeyboardEvent) this.focusTrap.handleTab(panel, event);
  }
}
