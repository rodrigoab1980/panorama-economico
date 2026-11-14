// Busca da lista de empresas (#38). Sem este arquivo a lista inteira continua visível:
// o campo de busca vem escondido no HTML e só aparece aqui.
(() => {
  const caixa = document.querySelector(".busca");
  const campo = document.getElementById("busca");
  if (!caixa || !campo) return;
  const vazia = caixa.querySelector(".busca-vazia");
  const itens = [...document.querySelectorAll(".setor li[data-busca]")];
  const setores = [...document.querySelectorAll(".setores .setor")];
  const semAcento = (texto) => texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  function filtrar() {
    const termos = semAcento(campo.value).split(/\s+/).filter(Boolean);
    let visiveis = 0;
    for (const li of itens) {
      const mostra = termos.every((t) => li.dataset.busca.includes(t));
      li.hidden = !mostra;
      if (mostra) visiveis++;
    }
    for (const setor of setores) setor.hidden = !setor.querySelector("li:not([hidden])");
    if (vazia) vazia.hidden = visiveis > 0;
  }

  caixa.hidden = false;
  campo.addEventListener("input", filtrar);
  // Enter abre a ficha quando sobra uma empresa só.
  campo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter") return;
    const links = itens.filter((li) => !li.hidden).map((li) => li.querySelector("a")).filter(Boolean);
    if (links.length === 1) window.location.href = links[0].href;
  });
  filtrar();
})();
