/** CodeMirror editor themed with the site tokens (follows light / dark like the source panels). */
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const siteTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ct-code-text)', backgroundColor: 'var(--ct-code-bg)', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--ct-font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--ct-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ct-accent)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--ct-accent) 24%, transparent)',
  },
  '.cm-gutters': { color: 'var(--ct-muted)', backgroundColor: 'var(--ct-code-bg)', borderRight: '1px solid var(--ct-border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ct-text) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--ct-text) 6%, transparent)', color: 'var(--ct-text)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--ct-accent-soft)', outline: '1px solid var(--ct-accent)' },
  '.cm-tooltip': { color: 'var(--ct-text)', backgroundColor: 'var(--ct-surface-2)', border: '1px solid var(--ct-border)' },
  '.cm-panels': { color: 'var(--ct-text)', backgroundColor: 'var(--ct-surface-2)' },
});

const highlight = HighlightStyle.define([
  { tag: [tags.comment], color: 'var(--ct-syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--ct-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--ct-syntax-number)' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.moduleKeyword, tags.controlKeyword], color: 'var(--ct-syntax-keyword)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--ct-syntax-type)' },
]);

export interface CodeEditor {
  view: EditorView;
  getValue(): string;
  setValue(source: string, tsx?: boolean): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  source: string,
  options: { tsx?: boolean; label: string; onRun: () => void; onChange?: () => void }
): CodeEditor {
  const language = new Compartment();
  const lang = (tsx = false) => javascript({ typescript: true, jsx: tsx });
  const view = new EditorView({
    doc: source,
    parent,
    extensions: [
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { options.onRun(); return true; } }])),
      basicSetup,
      language.of(lang(options.tsx)),
      siteTheme,
      syntaxHighlighting(highlight),
      EditorView.contentAttributes.of({ 'aria-label': options.label }),
      EditorView.updateListener.of((update) => { if (update.docChanged) options.onChange?.(); }),
    ],
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(next, tsx) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        effects: tsx === undefined ? [] : language.reconfigure(lang(tsx)),
      });
    },
    destroy: () => view.destroy(),
  };
}
