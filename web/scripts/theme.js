// Resolve o tema antes da primeira pintura, para a página não piscar claro
// antes de escurecer. O painel.js cuida da troca depois do carregamento.
(function () {
  var escolha = null;
  try {
    escolha = localStorage.getItem('tema');
  } catch (erro) {
    escolha = null;
  }
  var automatico = !escolha || escolha === 'auto';
  var escuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = automatico ? (escuro ? 'dark' : 'light') : escolha;
  document.documentElement.dataset.themeChoice = automatico ? 'auto' : escolha;
})();
