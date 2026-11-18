/**
 * Um identificador novo. `crypto.randomUUID` só existe em contexto seguro
 * (HTTPS ou localhost); o painel aberto por um `http://` na rede local não o
 * tem, e lançar ali derrubaria quem só quer salvar uma regra.
 */
export function uniqueId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  return typeof random === 'function'
    ? random.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
