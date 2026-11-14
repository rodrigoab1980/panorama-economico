// Escape de texto para o HTML da página Fundamentalista. Lógica pura.

// Escapa texto para dentro do HTML (conteúdo e atributo). Todo texto que vem de dado passa por aqui.
export function escapar(texto) {
  return String(texto ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
