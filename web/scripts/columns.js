// Aplica as colunas ocultas antes da primeira pintura, para a tabela não
// piscar com uma coluna que vai desaparecer um instante depois. O panel.js
// cuida da troca (checkboxes) e do reajuste de largura depois do carregamento.
(function () {
  // Mesmas chaves de REPORT_COLUMNS em gitlab_monitor.py: mantenha em sincronia.
  var CONHECIDAS = ['likes', 'mr', 'author', 'threads', 'openers', 'mergeable',
    'conflicts', 'pipeline', 'updated_label', 'created_label'];
  var ocultas = [];
  try {
    var bruto = localStorage.getItem('gitlabMonitorHiddenColumns');
    var lido = bruto ? JSON.parse(bruto) : [];
    if (Array.isArray(lido)) {
      ocultas = lido.filter(function (chave) { return CONHECIDAS.indexOf(chave) !== -1; });
    }
  } catch (erro) {
    ocultas = [];
  }
  window.gitlabMonitorHiddenColumns = ocultas;
  if (!ocultas.length) return;
  var regras = ocultas.map(function (chave) {
    // display: none no <col> tira a coluna da contagem de colunas da tabela
    // (como se o <col> não existisse), sem desalinhar o índice das colunas
    // seguintes. "visibility: collapse" e "width: 0" no <col> têm o mesmo
    // bug no Chromium: com table-layout: fixed e largura em px no <col>
    // seguinte, a largura da PRÓXIMA coluna visível sai errada. Como o
    // th/td da coluna também some (display: none abaixo), o índice bate dos
    // dois lados.
    return 'col.' + chave + ' { display: none !important; }\n'
      + 'th.' + chave + ', td.' + chave + ' { display: none; }';
  }).join('\n');
  var estilo = document.createElement('style');
  estilo.id = 'column-visibility';
  estilo.textContent = regras;
  document.head.appendChild(estilo);
})();
