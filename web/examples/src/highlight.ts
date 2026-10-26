/** Minimal TS / TSX syntax highlighter for the source panels (comments, strings, keywords, numbers). */
const KEYWORDS = new Set(
  'import export from default async await function return const let var new if else for of in while true false null undefined typeof as type interface extends class this void'.split(' ')
);
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    out += escape(code.slice(last, m.index));
    const [text, comment, str, num, word] = m;
    if (comment) out += `<span class="tok-c">${escape(text)}</span>`;
    else if (str) out += `<span class="tok-s">${escape(text)}</span>`;
    else if (num) out += `<span class="tok-n">${text}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="tok-k">${text}</span>`;
    else if (word && /^[A-Z]/.test(word)) out += `<span class="tok-t">${text}</span>`;
    else out += escape(text);
    last = m.index + text.length;
  }
  return out + escape(code.slice(last));
}
