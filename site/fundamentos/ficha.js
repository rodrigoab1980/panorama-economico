// Camada extra da ficha (#38): o balão com a fórmula, o documento de origem e o motivo do vazio.
// A página funciona sem este arquivo: as mesmas informações estão no `title` de cada célula.
// Aqui elas viram um balão que também abre com o toque, porque `title` não aparece no celular.
(() => {
  let balao = null;
  let alvo = null;

  const fechar = () => {
    if (balao) balao.remove();
    if (alvo) alvo.removeAttribute("aria-describedby");
    balao = null;
    alvo = null;
  };

  // O que mostrar para uma célula: a fórmula vem do nome do indicador (primeira coluna da linha),
  // o documento vem do cabeçalho da coluna, e o motivo, da própria célula.
  function conteudo(celula) {
    const linha = celula.closest("tr");
    const tabela = celula.closest("table");
    if (!linha || !tabela) return null;
    const nome = linha.querySelector("th.fixa");
    const partes = [];
    const titulo = nome ? nome.textContent.trim() : "";
    const formula = nome ? nome.dataset.dica || "" : "";
    if (celula === nome) {
      if (!formula) return null;
      partes.push(["", formula]);
    } else {
      const motivo = celula.dataset.dica || "";
      const cabecalho = tabela.tHead && tabela.tHead.rows[0] ? tabela.tHead.rows[0].cells[celula.cellIndex] : null;
      const origem = cabecalho ? cabecalho.dataset.dica || "" : "";
      if (motivo) partes.push(["motivo", `Sem valor: ${motivo}.`]);
      if (formula && linha.parentElement.tagName === "TBODY") partes.push(["", formula]);
      if (origem) partes.push(["", origem]);
      if (partes.length === 0) return null;
    }
    return { titulo, partes };
  }

  function abrir(celula) {
    const c = conteudo(celula);
    fechar();
    if (!c) return;
    balao = document.createElement("div");
    balao.className = "balao";
    balao.id = "balao-da-ficha";
    balao.setAttribute("role", "tooltip");
    const b = document.createElement("b");
    b.textContent = c.titulo;
    balao.append(b);
    for (const [classe, texto] of c.partes) {
      const p = document.createElement("p");
      if (classe) p.className = classe;
      p.textContent = texto;
      balao.append(p);
    }
    document.body.append(balao);
    alvo = celula;
    alvo.setAttribute("aria-describedby", balao.id);
    const r = celula.getBoundingClientRect();
    const largura = balao.offsetWidth;
    const esquerda = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - largura - 12));
    const abaixo = r.bottom + window.scrollY + 6;
    const cabe = r.bottom + balao.offsetHeight + 12 < window.innerHeight;
    balao.style.left = `${esquerda}px`;
    balao.style.top = `${cabe ? abaixo : Math.max(window.scrollY + 8, r.top + window.scrollY - balao.offsetHeight - 6)}px`;
  }

  // O `title` vira `data-dica`, para o navegador não mostrar a dica dele por cima do balão.
  for (const el of document.querySelectorAll(".serie [title]")) {
    el.dataset.dica = el.getAttribute("title");
    el.removeAttribute("title");
    if (el.matches("th.fixa, td.vazio")) el.tabIndex = 0;
  }

  const celulaDe = (evento) => (evento.target instanceof Element ? evento.target.closest(".serie th.fixa, .serie tbody td.n, .serie tfoot td") : null);

  document.addEventListener("click", (evento) => {
    if (evento.target instanceof Element && evento.target.closest("a")) return; // link do documento segue normalmente
    const celula = celulaDe(evento);
    if (!celula || celula === alvo) { fechar(); return; }
    abrir(celula);
  });
  document.addEventListener("mouseover", (evento) => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const celula = celulaDe(evento);
    if (celula && celula !== alvo) abrir(celula);
    else if (!celula && !(evento.target instanceof Element && evento.target.closest(".balao"))) fechar();
  });
  document.addEventListener("focusin", (evento) => { const celula = celulaDe(evento); if (celula) abrir(celula); });
  document.addEventListener("keydown", (evento) => { if (evento.key === "Escape") fechar(); });
  window.addEventListener("resize", fechar);
  for (const caixa of document.querySelectorAll(".rolagem")) caixa.addEventListener("scroll", fechar, { passive: true });
})();
