const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Prende o foco dentro de um painel modal e devolve o foco a quem abriu.
 *
 * Implementação própria porque o `InteractivityChecker` do CDK depende de
 * geometria, que o jsdom não tem — com ele, o comportamento não seria
 * testável fora do navegador. Enquanto ativo, qualquer foco que caia fora do
 * painel (ex.: o botão focado sumiu) volta para o painel.
 */
export class FocusTrap {
  private returnFocusTo: HTMLElement | null = null;
  private panel: HTMLElement | null = null;

  private readonly onFocusIn = (event: FocusEvent): void => {
    const alvo = event.target;
    if (this.panel && alvo instanceof Node && !this.panel.contains(alvo)) this.panel.focus();
  };

  public get active(): boolean {
    return this.panel !== null;
  }

  /** Guarda quem estava focado, põe o foco no painel e passa a segurá-lo nele. */
  public activate(panel: HTMLElement): void {
    if (this.panel === panel) return;
    const ativo = document.activeElement;
    this.returnFocusTo = ativo instanceof HTMLElement && !panel.contains(ativo) ? ativo : null;
    this.panel = panel;
    document.addEventListener('focusin', this.onFocusIn, true);
    panel.focus();
  }

  /** Para de segurar o foco e devolve-o a quem abriu. */
  public release(): void {
    if (!this.panel) return;
    document.removeEventListener('focusin', this.onFocusIn, true);
    this.panel = null;
    this.returnFocusTo?.focus();
    this.returnFocusTo = null;
  }

  /** Trata o Tab: circula entre os focáveis do painel. */
  public handleTab(panel: HTMLElement, event: KeyboardEvent): void {
    const focaveis = [...panel.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (!focaveis.length) {
      event.preventDefault();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    if (event.shiftKey && (ativo === primeiro || ativo === panel)) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && ativo === ultimo) {
      event.preventDefault();
      primeiro.focus();
    }
  }
}
