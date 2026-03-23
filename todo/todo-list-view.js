import { isTodoDoneValue } from './todo-sheets.js';
import { TW_BTN_EMOJI, TW_BTN_EMOJI_DANGER } from './todo-constants.js';
import { setStatus } from './todo-ui.js';

/**
 * @param {{
 *   state: { client: ReturnType<import('./todo-sheets.js').createGoogleSheetClient> | null, editingTodoId: string | null },
 *   todoList: HTMLElement,
 *   todoEmpty: HTMLElement,
 *   statusEl: HTMLElement
 * }} opts
 */
export function createTodoListView(opts) {
  const { state, todoList, todoEmpty, statusEl } = opts;

  async function refreshTodos() {
    const client = state.client;
    if (!client) {
      return;
    }
    const todos = await client.listTodos();
    todoList.replaceChildren();
    if (!todos.length) {
      state.editingTodoId = null;
      todoEmpty.hidden = false;
      return;
    }
    todoEmpty.hidden = true;
    if (state.editingTodoId && !todos.some((t) => t.id === state.editingTodoId)) {
      state.editingTodoId = null;
    }
    for (const todo of todos) {
      const li = document.createElement('li');
      li.className = 'flex flex-nowrap items-center gap-3 py-2.5';

      const rowActions = document.createElement('div');
      rowActions.className = 'flex shrink-0 flex-nowrap items-center gap-1';

      if (todo.id === state.editingTodoId) {
        const editWrap = document.createElement('div');
        editWrap.className = 'flex min-w-0 flex-1 flex-nowrap items-center gap-2';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className =
          'min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-base focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-violet-500';
        inp.id = `todo-edit-${todo.id}`;
        inp.maxLength = 500;
        inp.value = (todo.title || '').trim();
        inp.setAttribute('aria-label', 'Edit todo text');
        inp.setAttribute('data-todo-edit-focus', '');
        const btnUpdate = document.createElement('button');
        btnUpdate.type = 'button';
        btnUpdate.className =
          'shrink-0 rounded-full border border-violet-600 bg-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:border-violet-500 dark:hover:bg-violet-500';
        btnUpdate.textContent = 'Update';

        const finishEdit = () => {
          state.editingTodoId = null;
          void refreshTodos();
        };

        let suspendBlurCancel = false;

        const commit = async () => {
          if (!state.client) {
            return;
          }
          const next = inp.value.trim();
          const prev = (todo.title || '').trim();
          if (next === prev) {
            finishEdit();
            return;
          }
          suspendBlurCancel = true;
          btnUpdate.disabled = true;
          inp.disabled = true;
          try {
            setStatus(statusEl, 'Updating…');
            await state.client.updateTodoTitle(todo.id, next);
            setStatus(statusEl, '');
            finishEdit();
          } catch (e) {
            setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
          } finally {
            btnUpdate.disabled = false;
            inp.disabled = false;
            suspendBlurCancel = false;
          }
        };

        btnUpdate.addEventListener('click', () => {
          void commit();
        });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            void commit();
          }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            finishEdit();
          }
        });
        inp.addEventListener('blur', () => {
          window.setTimeout(() => {
            if (suspendBlurCancel) {
              return;
            }
            if (!li.contains(document.activeElement)) {
              finishEdit();
            }
          }, 0);
        });

        editWrap.appendChild(inp);
        editWrap.appendChild(btnUpdate);
        li.appendChild(editWrap);
      } else {
        const done = isTodoDoneValue(todo.done);

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = done;
        chk.className =
          'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-zinc-300 text-violet-600 focus:ring-violet-400 dark:border-zinc-500 dark:bg-zinc-900 dark:text-violet-500';
        chk.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        chk.addEventListener('change', async () => {
          if (!state.client) {
            chk.checked = done;
            return;
          }
          const next = chk.checked;
          chk.disabled = true;
          try {
            setStatus(statusEl, next ? 'Marking done…' : 'Marking active…');
            await state.client.setTodoDone(todo.id, next);
            setStatus(statusEl, '');
            await refreshTodos();
          } catch (e) {
            chk.checked = done;
            setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
          } finally {
            chk.disabled = false;
          }
        });

        const displayTitle = (todo.title || '').trim() || '—';
        const line = document.createElement('div');
        line.className =
          'min-w-0 flex-1 cursor-pointer touch-manipulation break-words pr-1 text-[0.95rem] [-webkit-tap-highlight-color:transparent]';
        line.addEventListener('click', () => {
          state.editingTodoId = todo.id;
          void refreshTodos();
        });
        const dateEl = document.createElement('span');
        dateEl.className = 'mr-1.5 text-[0.82em] text-zinc-500 dark:text-zinc-400';
        dateEl.textContent = todo.createdAt
          ? String(todo.createdAt).slice(0, 19).replace('T', ' ')
          : '—';
        const contentEl = document.createElement('span');
        contentEl.className = 'text-zinc-900 dark:text-zinc-100';
        contentEl.textContent = displayTitle;
        line.appendChild(dateEl);
        line.appendChild(document.createTextNode(' '));
        line.appendChild(contentEl);
        if (done) {
          line.classList.add('line-through', 'opacity-65');
        }

        const rowMain = document.createElement('div');
        rowMain.className = 'flex min-w-0 flex-1 items-start gap-3';
        rowMain.appendChild(chk);
        rowMain.appendChild(line);
        li.appendChild(rowMain);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = TW_BTN_EMOJI;
        editBtn.setAttribute('aria-label', 'Edit todo');
        editBtn.title = 'Edit';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => {
          state.editingTodoId = todo.id;
          void refreshTodos();
        });
        rowActions.appendChild(editBtn);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = TW_BTN_EMOJI_DANGER;
      del.setAttribute('aria-label', 'Remove todo');
      del.title = 'Remove';
      del.textContent = '🗑️';
      del.addEventListener('click', async () => {
        del.disabled = true;
        try {
          setStatus(statusEl, 'Removing…');
          if (todo.id === state.editingTodoId) {
            state.editingTodoId = null;
          }
          if (!state.client) {
            return;
          }
          await state.client.removeTodo(todo.id);
          await refreshTodos();
          setStatus(statusEl, '');
        } catch (e) {
          setStatus(statusEl, e instanceof Error ? e.message : String(e), true);
        } finally {
          del.disabled = false;
        }
      });
      rowActions.appendChild(del);
      li.appendChild(rowActions);
      todoList.appendChild(li);
    }

    if (state.editingTodoId) {
      const focusInp = todoList.querySelector('[data-todo-edit-focus]');
      if (focusInp instanceof HTMLInputElement) {
        focusInp.focus();
        focusInp.select();
      }
    }
  }

  return { refreshTodos };
}
