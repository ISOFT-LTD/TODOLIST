/**
 * What a list shows when it has nothing in it.
 *
 * Inside the Core, the Core draws it: sdk.ui.noData(), the empty state the
 * Core shows for its own lists, with the plugin's text as its title. The
 * plugin hands it the text of the moment and draws it again when the
 * language changes; the Core draws whatever it is given.
 *
 * Where there is no sdk.ui - the standalone page Cobalt Core serves, or a
 * Core from before sdk.ui - the plugin's own line of text stands in.
 *
 *   const empty = createEmptyState(ui, texts);
 *   empty.show(list, 'todo.no-todos')    in render, when there is nothing
 *   empty.clear()                        before render empties the list, and in the teardown
 */

/**
 * @param {{ noData?: Function } | undefined} ui sdk.ui, when the host gives one
 * @param {ReturnType<import('../plugin-translation.js').createPluginTranslation>} texts
 */
export function createEmptyState(ui, texts) {
  const drawnByCore = typeof ui?.noData === 'function';
  /** The Core's drawing on screen: where, under which key, and what erases it. */
  let drawn = null;

  const draw = () => {
    if (!drawn) return;
    // A second call on the same element replaces the first drawing.
    drawn.erase = ui.noData(drawn.slot, { title: texts.t(drawn.key), compact: true });
  };
  if (drawnByCore) texts.onChange(draw);

  return {
    show(container, key) {
      this.clear();
      if (!drawnByCore) {
        const line = document.createElement('p');
        line.className = 'empty';
        texts.text(line, key);
        container.append(line);
        return;
      }
      const slot = document.createElement('div');
      container.append(slot);
      drawn = { slot, key, erase: null };
      draw();
    },

    clear() {
      if (!drawn) return;
      drawn.erase?.();
      drawn = null;
    },
  };
}
