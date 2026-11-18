/**
 * Mesma lista de colunas, item a item. O /data chega a cada ciclo com um
 * array novo de mesmo conteúdo, e escrever o sinal com essa identidade nova
 * faria tudo que depende das colunas recalcular a cada dez segundos.
 */
export function sameColumnKeys(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((key, index) => key === next[index]);
}
