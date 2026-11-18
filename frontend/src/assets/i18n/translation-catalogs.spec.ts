import en from './en.json';
import pt from './pt.json';

type Catalog = Record<string, unknown>;

/** Todas as chaves folha, em notação de ponto. */
function keys(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' ? keys(value as Catalog, path) : [path];
  });
}

/** Os marcadores {{...}} de um texto, em ordem. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
}

function leaf(catalog: Catalog, path: string): string {
  return path
    .split('.')
    .reduce<unknown>((node, part) => (node as Catalog)[part], catalog) as string;
}

describe('catálogos de tradução', () => {
  const ptKeys = keys(pt as Catalog).sort();
  const enKeys = keys(en as Catalog).sort();

  it('pt e en têm exatamente as mesmas chaves', () => {
    // Chave só em um dos dois vira texto faltando na tela, e o reserva do
    // ngx-translate devolveria a própria chave crua para o usuário ver.
    expect(ptKeys).toEqual(enKeys);
  });

  it('cada chave tem texto, nunca vazio', () => {
    for (const path of ptKeys) {
      expect(leaf(pt as Catalog, path).trim().length, path).toBeGreaterThan(0);
      expect(leaf(en as Catalog, path).trim().length, path).toBeGreaterThan(0);
    }
  });

  it('os dois idiomas interpolam os mesmos valores', () => {
    // Um {{count}} que existe só num idioma some do texto traduzido sem
    // erro nenhum: o teste é o que avisa.
    for (const path of ptKeys) {
      expect(placeholders(leaf(pt as Catalog, path)), path).toEqual(
        placeholders(leaf(en as Catalog, path)),
      );
    }
  });
});
