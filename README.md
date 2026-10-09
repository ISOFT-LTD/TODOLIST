# todo-plugin-poc

> **This is a test app, not a product.** It exists to prove the plugin
> architecture for the future ITSM platform: an application with its own UI,
> API and data, living behind Cobalt Core. The Todo app itself is deliberately
> minimal and disposable.

## What this POC is

A small Todo List, with reusable predefined lists, packaged the way a Cobalt
Core application is:

- a **FastAPI service** that owns its own API and data, and trusts only the
  identity Cobalt Core signs
- a **frontend exposed through Module Federation**, so the ITSM React shell can
  load it at runtime without rebuilding - and a standalone page Core serves today
- a **`manifest.json`** describing the app to Core, which installs it from there
- **two Docker images** from this one repository: the frontend image (the UI,
  and the app's single entry point for Core) and the backend image (the API)

The browser never talks to the Todo service. It talks to Core only:

```
Browser, logged in to Cobalt (HttpOnly session cookie)
        │  GET /apps/todo/api/todos
        ▼
Cobalt Core
   • validates the session, checks the user may reach "todo" at all
   • mints a 3-minute JWT for audience "todo" with the user's actions
        │  Authorization: Bearer <jwt>, server to server
        ▼
todo-frontend (nginx, 127.0.0.1:8080)  ── /api/ ──►  todo-backend (FastAPI)
   serves the page and the federated module          verifies the JWT against
                                                      Core's public keys, then
                                                      answers from /data/todos.json
```

The UI knows nothing about cookies, tokens, CORS or URLs: it only calls the SDK
it is given. The backend holds no session and no password, and never touches
Core's database.

## Install it into Cobalt Core

What you get: `https://<core>:3008/apps/todo/` shows the Todo List to anyone
logged in to Cobalt who has the Todo actions assigned for the operations they use -
and `https://<core>:3008/apps/todo/predefined` their predefined lists. Every
user has their own.

**Core needs** (all on `working-merge-integration`): delegated identity
configured (`CORE_JWT_PRIVATE_KEY_FILE` - the startup log says
`Delegated identity: issuer=...`), the `todo` tab (commit `2024737c`), and
install-from-manifest (`b4bb8d8a`).

**1. Get the app** on the machine where Core runs:

```bash
git clone -b cobalt-core-integration https://github.com/ISOFT-LTD/TODOLIST.git && cd TODOLIST
```

**2. Configure it.** Copy the example and set Core's details:

```bash
cp .env.example .env
```

| Setting | Value |
|---|---|
| `COBALT_CORE_JWKS_URL` | `https://<core-hostname>:3008/auth/.well-known/jwks.json` - use Core's real name, so TLS verification passes |
| `CORE_HOSTNAME` | the same `<core-hostname>`; inside the container it resolves to this machine |
| `COBALT_TENANT_ID` | exactly Core's `CORE_TENANT_ID` (e.g. `itec-prod`) |
| `COBALT_ISSUER` | Core's `CORE_JWT_ISSUER` (`cobalt-core`) |

If the URL cannot work on your network, save Core's keys to a file instead:
`curl -sk https://127.0.0.1:3008/auth/.well-known/jwks.json -o cobalt/core-jwks.json`,
then set `COBALT_CORE_JWKS_FILE=/run/cobalt/core-jwks.json` and leave the URL
empty. A file does not follow a key rotation - fetch it again after one.

**3. Start it:**

```bash
docker compose up -d --build
```

```bash
curl -s http://127.0.0.1:8080/api/health
```

`{"status":"ok"}` means the gateway and the backend are both up. The backend
refuses to start at all if it cannot load Core's keys - `docker logs
todo-backend` says why.

**4. Tell Core where the app is.** Add to Core's `.env`, then recreate Core:

```
COBALT_APP_URL_TODO=http://127.0.0.1:8080
```

**5. Install it into Core.** From Core's folder - the script fetches this
app's manifest from the running app and registers it:

```bash
docker compose exec app python scripts/install_application.py --from-service todo
```

It prints `Todo List (todo 1.3.0): registered` and a checklist. Installing
again after an upgrade is the same command. From a browser instead, as an
administrator: `POST /auth/applications/install` with this repository's
`manifest.json` as the body.

**6. Give people access.** SuperUser already holds every tab. For anyone else,
grant a role the **todo** tab on the roles screen: **Read** to view, **All** to
add, edit, tick and delete.

**7. Open it:** log in to Cobalt, then in the same browser go to
`https://<core-hostname>:3008/apps/todo/`. The two links at the top switch
between the To do List and the Predefined to do lists.

**8. Give the app its texts.** The UI holds no words of its own, in any
language: every text is a key, and the text for it comes from the application's
translation database through the Core (see [Text and
translations](#text-and-translations)). The keys are listed in
[`frontend/translations/todo-translation-keys.xlsx`](frontend/translations/todo-translation-keys.xlsx):
one column, `key`, nothing else. Add a row to the translation database for
each of them, with its text in every language, then sign in again. A key with
no row is shown as the key (`todo.title`) - in the ITSM shell until its row
exists, and always on the standalone page at `/apps/todo/`, which has no
translations to read.

### When it does not work

| You see | It means |
|---|---|
| 401 on `/apps/todo/` | Not logged in to Cobalt in this browser |
| 403 "No access to this application" | This user holds no Read on the todo tab (step 6) |
| 404 "Unknown application" | Not installed yet (step 5) |
| 503 naming `COBALT_APP_URL_TODO` | Core does not know where the app is (step 4) |
| 502 "The application rejected Core's identity" | The backend refused Core's token: `COBALT_TENANT_ID` / `COBALT_ISSUER` differ from Core's, or it cannot fetch Core's keys. `docker logs todo-backend` names the reason |
| "You can view this list but not change it" | The user holds Read, not All |

## Project structure

```
TODOLIST/
├── manifest.json            what Core installs from (manifestVersion 2)
├── docker-compose.yml       both services, private beside Core
├── .env.example             every setting, documented
├── cobalt/                  optional saved copy of Core's public keys
├── dev/fake_core.py         a local stand-in for Core, for development
├── backend/                 FastAPI service
│   ├── main.py              routes; every data route needs Core's identity
│   ├── auth.py              verifies Core's JWT, checks delegated actions
│   ├── models.py            todos and predefined lists, scoped to their owner
│   ├── database.py          JSON file storage, one file per kind of record
│   ├── schemas.py
│   ├── cobalt_identity/     the SDK, copied from Cobalt_Api (see VENDORED.md)
│   └── tests/
└── frontend/                Vite app
    ├── src/todo-app.js      the plugin shell, exposed as the federated ./TodoApp:
    │                        mount/unmount, and which page a sub-path shows
    ├── src/pages/           the pages: todo-list.js, predefined-lists.js
    ├── src/extensions/      Computer Details contributions: ./ComputerTodoAction,
    │                        ./ComputerTodoTab, and the mount contract they share
    ├── src/plugin-translation.js
    │                        the plugin's text, read from the Core through sdk.i18n
    ├── src/todo-events.js   "todos changed", between the plugin's own modules
    ├── src/core-sdk.js      the SDK the standalone page uses: calls through Core
    ├── src/main.js          the standalone page
    ├── src/testing/         stand-ins for the tests only: never shipped
    ├── translations/        the plugin's key inventory - keys only, no texts:
    │                        the CSV, the workbook built from it, their tools
    └── nginx.conf.template  serves the UI, hands /api/ to the backend
```

## Develop it without Core

`dev/fake_core.py` does what Core's proxy does - mints a real token for this app
with a throwaway key - and starts the backend pointed at that key. The backend
has no idea it exists; nothing about it reaches production.

```bash
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

```bash
python dev/fake_core.py
```

```bash
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`. `DEV_ACCESS=read` makes you a read-only user,
`DEV_USER_ID` and `DEV_USERNAME` change who you are. Stop it with Ctrl+C.

Tests:

```bash
python -m pytest backend/tests
```

```bash
cd frontend && npm test
```

After adding or removing a key, update the key inventory
(`frontend/translations/todo-translation-keys.csv`) and rebuild its workbook;
a test fails until the code, the inventory and the workbook agree:

```bash
cd frontend && npm run translation-keys
```

## API

All under the backend's `/api`; through Core, under `/apps/todo/api`.

| Method | Path | Needs |
|---|---|---|
| GET | `/api/todos` | `todo.read_todo` - this user's todos, newest first; `?computer_id=N` for one computer's |
| POST | `/api/todos` | `todo.add_todo` - `{ "title", "computer_id"? }` |
| PUT | `/api/todos/{id}` | `todo.update_todo` - title and/or done |
| DELETE | `/api/todos/{id}` | `todo.delete_todo` |
| GET | `/api/predefined-lists` | `todo.read_predefined_list` - this user's predefined lists, newest first |
| POST | `/api/predefined-lists` | `todo.add_predefined_list` - `{ "name", "items": [...] }` |
| PUT | `/api/predefined-lists/{id}` | `todo.update_predefined_list` - name and/or items |
| DELETE | `/api/predefined-lists/{id}` | `todo.delete_predefined_list` |
| GET | `/api/me` | any valid token - who is calling and their delegated actions |
| GET | `/api/health` | open |
| GET | `/api/manifest` | open - Core installs from it |
| GET | `/api/openapi.json` | open |

Core delegates the action keys declared by the plugin manifest in each signed
JWT. Every data route requires its own action. Another user's todo or list
answers 404, not 403, so ids reveal nothing.

A predefined list is a reusable template - a name and the todo titles it would
create, such as *New Employee Setup: create account, assign laptop, configure
email*. Both fields are trimmed; a blank name, an empty list or a blank item is
refused (422). Creating real todos from a template is not implemented yet.

A todo can be **about a Core computer**: `computer_id` is Core's own id for
it, as the Computer Details page passes it, kept as given (a positive integer,
never checked against Core). A todo without one has `null`. Todos only gain a
computer when created with one; updating a todo keeps it.

## Integration

### manifest.json

Core reads `id`, `name`, `description`, `version`, the **`core`** section, and
the plugin's `actions` catalog. The catalog is an array of action-key strings;
Core can grant those keys and include the granted set in the delegated JWT.
Where the app runs is never in the manifest: Core
takes it from `COBALT_APP_URL_TODO`, so shipping a manifest cannot redirect
Core's traffic. The `frontend` section is for the ITSM shell.

**`navigation`** uses the grouped contract: one group, labelled by the key
`to-do`, with two children that both belong to this one plugin:

| Label | Path | Action |
|---|---|---|
| To do List | `/plugins/ui/todo` | `todo.read_todo` |
| Predefined to do list | `/plugins/ui/todo/predefined` | `todo.read_predefined_list` |

Both load the same federated module; the sub-path below the plugin's root
(`''` or `/predefined`) tells it which page to render (see below).

The Core draws every label and translates it. The group's label is written
as a key, `to-do`, and is in the key inventory. The two page labels are
**still words, and that is not settled**: in the Core's contract a page's
`label` is one field with two uses. See
[Page labels](#page-labels-blocked-by-the-cores-contract).

**`contributes`** puts this plugin into Core pages, at the extension targets
the Core defines. The Core decides where each renders, filters them by the
user's actions, orders, loads, mounts, updates and unmounts them:

| id | Target | Exposed module | Action | Tab |
|---|---|---|---|---|
| `computer-todo-action` | `computer.details.header.actions` | `./ComputerTodoAction` | `todo.add_todo` | - |
| `computer-todo-tab` | `computer.details.tabs` | `./ComputerTodoTab` | `todo.read_todo` | label `to-do` (a key), `fa-square-check` |

The header action adds todos, so only users with `todo.add_todo` see it; the
tab is shown to users with `todo.read_todo`. The tab's label is a key: the Core
draws the tab and translates it.

### Module Federation remote

| | |
|---|---|
| Remote name | `todo_plugin` |
| Entry | `remoteEntry.js` - through Core, `/apps/todo/remoteEntry.js` |
| Exposed modules | `./TodoApp` (the pages), `./ComputerTodoAction`, `./ComputerTodoTab` (contributions) |
| Shared dependencies | none |

```js
const { mount } = await loadRemote('todo_plugin/TodoApp');
const unmount = mount(containerElement, { sdk, path: '/predefined' });
```

`path` is the sub-path below the plugin's root as the manifest's navigation
names it: `''` (or `'/'`) for the To do List, `'/predefined'` for the
Predefined to do lists. An unknown path shows the To do List. When the shell
passes no `path`, the plugin reads it off the page URL, so a shell that only
routes the address bar still lands on the right page. To switch pages, unmount
and mount again with the new path.

### Computer Details contributions

Each contribution module exports `mount(el, context, sdk)`, the Core's
contribution contract, and is a different contract from `./TodoApp`'s:

```js
const { mount } = await loadRemote('todo_plugin/ComputerTodoTab');
const handle = mount(hostElement, { computerId: 42 }, sdk);
handle.update({ computerId: 43 }); // same host, another computer
handle.unmount();                  // host going away: renders nothing any more
```

| Module | Renders |
|---|---|
| `./ComputerTodoAction` | A compact **Add Todo** button. It opens a small dialog that adds a todo with this `computer_id`, then asks the Core for a success toast (`sdk.notify`). |
| `./ComputerTodoTab` | The To do List scoped to the computer: its todos, ticked, edited and deleted as on the standalone page, and new ones added to it. |

Both render in a shadow root on `el` and touch nothing outside it; `update()`
redraws only when `computerId` changes, and `unmount()` is safe to repeat. A
todo added from the header shows up in the open tab without a reload: the two
modules share the plugin's own `todo-events.js`, never the Core's DOM. A
context without a usable `computerId` renders nothing (the action) or a short
notice (the tab), instead of failing.

### SDK contract

The UI never imports Core code. Everything goes through the `sdk` passed to
`mount`; the pages use `sdk.api` and `sdk.i18n`, and the contributions also
`sdk.notify` when the Core provides it:

| Method | Example |
|---|---|
| `sdk.api.get(path)` | `sdk.api.get('/todos')` |
| `sdk.api.post(path, body)` | `sdk.api.post('/todos', { title })` |
| `sdk.api.put(path, body)` | `sdk.api.put('/todos/1', { done: true })` |
| `sdk.api.delete(path)` | `sdk.api.delete('/todos/1')` |
| `sdk.i18n.translate(key)` | `sdk.i18n.translate('todo.add')` - the text in the user's language, or the key |
| `sdk.i18n.subscribe(listener)` | called when the translations have changed; returns what ends it |

`path` is relative to the app's API. Each call resolves to the parsed JSON (or
`null`) and rejects with an `Error` whose message is safe to show. `mount`
refuses an SDK that lacks any of these.

- **The ITSM shell's SDK** must send `path` to
  `<Core>/apps/todo/api<path>` with `credentials: 'include'`, and never add a
  token of its own - Core adds the one this app verifies.
- **The standalone page** uses [`frontend/src/core-sdk.js`](frontend/src/core-sdk.js),
  which does exactly that relative to the page, and turns Core's 401 / 403 /
  502 into messages a person can act on.

The UI renders in a shadow root, so the shell's CSS and the app's cannot leak
into each other, and the build uses relative paths, so it works under
`/apps/todo/` or any other prefix.

### Text and translations

**This project holds translation keys only.** There is no text of the UI in
it in any language: no English, no Portuguese, no fallback for a missing
translation, no `en.json`, no `locales/`, no table of words in the code or
beside it, and no request for translations. The centralized translation
database is the only source of what a user reads.

```
translation database                the only place a text is kept
        ↓
the Core's translation API          requested by the Core, and by nobody else
        ↓
the Core's translations
        ├──→ Core UI, and the plugin's labels the Core draws (sidebar, tab)
        └──→ sdk.i18n  →  this plugin's pages and contributions
```

Every text the plugin draws is asked for by a key of the form `todo.<key>`:

```js
texts.t('todo.add')
```

and what `sdk.i18n.translate` answers is what is shown, whatever it is. When
the database has no row for a key the Core answers with the key, and the key
is what the user sees - `todo.add`. That is deliberate: a missing row stays
visible instead of hiding behind words the plugin made up.

**The helper.**
[`frontend/src/plugin-translation.js`](frontend/src/plugin-translation.js)
is the one place that reads `sdk.i18n.translate` and listens to
`sdk.i18n.subscribe`. It is the vanilla-JS counterpart of the
`usePluginTranslation()` helper the Core's skeleton gives React plugins -
this plugin has no React. A page or a contribution creates one for its root
and asks it for text; it never subscribes itself.

| | |
|---|---|
| `<h1 data-i18n="todo.title"></h1>` | Markup names its text by key, and holds none. |
| `data-i18n-placeholder`, `-title`, `-aria-label` | The same for an attribute. |
| `texts.text(el, 'todo.edit')` | An element made later. |
| `texts.t('todo.computer')` + the id | Text composed with data: the word by key, the data as it is. Redrawn through `texts.onChange`. |
| `texts.plain(el, error.message)` | Data, shown as it is and never looked up. |
| `texts.stop()` | In the teardown: ends the one subscription. |

**A change of language** reaches a mounted page or contribution through
`sdk.i18n.subscribe` and nothing else: no unmount, no mount, no new SDK, no
request. The helper redraws every text in place, so the elements stay, and
with them what the user typed and what the page holds.

**Data is not text.** Todo titles, list names and items, the user's name, the
computer id and whatever an API answered are shown as they are, never looked
up as keys.

**Errors.** What is wrong with what the user entered is the plugin's to say,
and it says it by key. An error of the API is worded by the SDK and reaches
the plugin as data. The `todo-plugin: mount() needs ...` messages are thrown
at the host when it breaks the mount contract - no element, or an SDK without
`sdk.api` or `sdk.i18n`. They are for whoever integrates the plugin, and the
one about `sdk.i18n` could not be translated in any case. The Core's page
host does print the message of a failed `mount` under its own "could not be
loaded" text, so a broken integration would show one on screen.

**The key inventory.**
[`frontend/translations/todo-translation-keys.csv`](frontend/translations/todo-translation-keys.csv)
is the one authoritative list of the keys this plugin asks for: one column,
`key`, one key on each line, sorted. It holds no text and cannot: reading it
fails on anything that is not a key. It is a text file so that a review can
read it and a diff can show it.
[`todo-translation-keys.xlsx`](frontend/translations/todo-translation-keys.xlsx)
is the same keys in the one column of a sheet, built from the CSV by
`npm run translation-keys` with no dependency, for whoever prepares the rows
of the translation database. Neither is a catalog. Nothing the plugin ships
imports them.

`npm test` fails when:

- a key the code or the manifest asks for is missing from the inventory, or
  the inventory holds a key nothing asks for;
- the inventory holds anything but keys - a second column, a space, a
  capital - or a key twice, or out of order;
- the workbook is not exactly what the inventory builds;
- a key is built at run time instead of written out;
- the code puts words of its own behind a key (`t(key) || '...'`, and the
  like);
- a surface of the plugin shows a word that did not come from `sdk.i18n`:
  every page and contribution, and the dialog, is drawn in every state it
  can be in - before the API answers, with data, empty, read-only, being
  edited, refusing what was entered, with an API error, after a change of
  language - with translations that answer each key as a mark, and read
  back.

The tests hold no translations either. Their stand-in for `sdk.i18n` answers
a key with the key itself, marked with the language: `⟦en:todo.add⟧`, and
`⟦pt:todo.add⟧` after a change.

**Keys.** The plugin's own are `todo.<key>`. It reads no key of the Core's.
The label the Core draws for the group and for the Computer Details tab is
the key `to-do`.

> `todo.*` and `to-do` do not start with `plugin.`, which is the namespace
> the Core's documents reserve for plugins (`plugin.<id>.<key>`); by those
> documents a key without that prefix is a key of the Core. Whoever adds the
> rows must check that none of these keys is already in use, above all
> `to-do`.

#### Page labels: blocked by the Core's contract

The two page labels in `manifest.json` are still English words, and this
repository cannot change that on its own. In the Core, the `label` of a
group's child is one field with two uses that cannot be separated:

```
navigation child { path, label }
        │
        ├─→ tabName = label, exactly as written     (api/fetchPlugins.ts, pageOfGroup)
        │     └─→ looked up in the user's allowed_tabs by exact tab_name
        │           └─→ sidebar entry shown / hidden, route open / 403
        │
        └─→ key = label in lower case, spaces as hyphens   (sidebarTranslationKey)
              └─→ the application's translations  →  the text on screen
```

| Label | It is the tab | The Core translates it by |
|---|---|---|
| `To do List` | `To do List` | `to-do-list` |
| `Predefined to do list` | `Predefined to do list` | `predefined-to-do-list` |
| `todo.list` (a key) | `todo.list` | `todo.list` |

So the text on screen is already translated, by a key the Core derives. But
writing a key as the label renames the tab: the page is then granted only to
users whose `allowed_tabs` holds that exact name, and the names of the tabs
are the Core's - its permission data - not this plugin's. The Core's own
notes say its login data names these tabs `todo-list` and `todo-predefined`,
which is neither of the labels above. What the Core's backend sends as the
label of each page could not be checked from here. Until it is decided
there - a label that is a key *and* the tab's name, or a field of its own
for the tab - the labels stay as they are, their keys are not in the
inventory, and the test suite carries an open `todo` for it.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `COBALT_CORE_JWKS_URL` | - | Backend: Core's public keys (one of these two is required) |
| `COBALT_CORE_JWKS_FILE` | - | Backend: a saved copy of them |
| `COBALT_ISSUER` | `cobalt-core` | Backend: must equal Core's `CORE_JWT_ISSUER` |
| `COBALT_TENANT_ID` | any | Backend: must equal Core's `CORE_TENANT_ID` |
| `COBALT_AUDIENCE` | `todo` | Backend: this app's key in Core |
| `CORE_HOSTNAME` | - | Compose: Core's name, mapped to this machine in the backend container |
| `TODO_BIND_ADDRESS` / `TODO_PORT` | `127.0.0.1` / `8080` | Compose: where Core reaches the gateway |
| `TODO_DATA_FILE` | `backend/todos.json` (Docker: `/data/todos.json`) | Backend storage: todos |
| `TODO_PREDEFINED_FILE` | `backend/predefined_lists.json` (Docker: `/data/predefined_lists.json`) | Backend storage: predefined lists |
| `MANIFEST_PATH` | `manifest.json` at the repo root | `/api/manifest` |
| `VITE_API_TARGET` | `http://127.0.0.1:8001` | `npm run dev` proxy (the fake Core) |

## Published images (GHCR)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds both images and pushes them to GitHub Container Registry on a push to
`main` (`:main`, `:sha-<short>`) or a `v1.2.3` tag (`:1.2.3`, `:1.2`, `:latest`).
Pull requests build without pushing. New GHCR packages are private by default.

## Known limitations

Deliberate for a throwaway POC:

- **JSON file storage**, one file per kind of record, rewritten on every
  change; **one uvicorn worker**, since
  writes are serialised with an in-process lock (the image pins `--workers 1`).
  The replay cache for token ids is per process too, which is why one worker
  is also what the identity check expects.
- **Todos from before owners existed are not shown.** Each todo now belongs to
  one user; rows written by the earlier, unauthenticated version belong to
  nobody.
- **Predefined lists are templates only.** Creating todos from one is a later
  feature. They belong to the user who made them, like todos.
- **The ITSM panel's menu comes from the manifest's `navigation`.** Until the
  shell renders it, the standalone page's two links are the way between the
  pages.
- **The standalone page shows keys, not words.** Its SDK
  (`frontend/src/core-sdk.js`) has no translations to read, and the app
  holds none, so everything on `/apps/todo/` reads as its key: the pages, the
  two links at the top, the page title (`todo.title`) and the SDK's own
  errors (`todo.error-session-ended`). Text appears where the Core's
  translations are: in the ITSM shell.
