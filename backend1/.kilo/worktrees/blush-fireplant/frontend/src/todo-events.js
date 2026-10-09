/**
 * "The todos changed" - between this plugin's own pieces, and nothing else.
 *
 * The Computer Details header action adds a todo; the Computer Details tab,
 * if it is open on the same page, should show it. Both are exposed modules of
 * the same remote, so they share this module and can tell each other without
 * going through the Core or its DOM.
 *
 *   const off = onTodosChanged(({ computerId }) => reload());
 *   todosChanged({ computerId: 42 });
 *   off();
 */

const listeners = new Set();

/** Listen for changes. Returns the function that stops listening. */
export function onTodosChanged(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Say the todos changed; `computerId` names the computer they are about, if any. */
export function todosChanged(change = {}) {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch (error) {
      // One broken listener must not stop the others hearing about it.
      console.error('todo-plugin: a todosChanged listener failed', error);
    }
  }
}
