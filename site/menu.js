// Botão de menu da barra de topo (site/menu.css), igual em todas as páginas. Sem biblioteca.
// O botão vem escondido no HTML; aqui ele é ligado, e a barra ganha a classe .com-botao. Abaixo de
// 640 px o CSS troca os itens pelo botão. Sem este arquivo, a lista de itens fica à vista.
//   - clique, Enter ou espaço no botão: abre e fecha, e o aria-expanded acompanha;
//   - Esc com o menu aberto: fecha e devolve o foco ao botão;
//   - ao passar de 640 px, o menu fecha: no desktop não há botão.
(() => {
  const barra = document.querySelector(".barra-site");
  const botao = barra && barra.querySelector(".barra-botao");
  if (!botao) return;
  const aberto = () => botao.getAttribute("aria-expanded") === "true";
  const abrir = (sim) => {
    botao.setAttribute("aria-expanded", String(sim));
    barra.classList.toggle("aberta", sim);
  };
  botao.hidden = false;
  barra.classList.add("com-botao");
  botao.addEventListener("click", () => abrir(!aberto()));
  barra.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !aberto()) return;
    abrir(false);
    botao.focus();
  });
  window.matchMedia("(min-width: 640px)").addEventListener("change", (e) => { if (e.matches) abrir(false); });
})();
