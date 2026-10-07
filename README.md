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
- a **`pulsar.yaml`**, the Forge manifest: the one file that says what the app
  is. Forge installs, upgrades and rolls the app back from it, and
  `manifest.json`, which Core reads at `/api/manifest`, is rendered from it
- **two Docker images** from this one repository: the frontend image (the
  gateway: the UI, and the app's single entry point for Core) and the backend
  image (the API), both built from the repository root

The browser never talks to the Todo service. It talks to Core only:

```
Browser, logged in to Cobalt (HttpOnly session cookie)
        │  GET /apps/todo/api/todos
        ▼
Cobalt Core
   • validates the session, checks the user may reach "todo" at all
   • mints a 3-minute JWT for audience "todo" with the user's permissions
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
logged in to Cobalt who holds the **todo** tab - Read to view, All to edit -
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

**Upgrading from 1.3.0 or older?** The backend no longer runs as root, so the
files an older image wrote on the `todo-data` volume must first belong to its
user (uid 10001). Once, before starting the new image:

```bash
docker compose run --rm --no-deps --user 0 --entrypoint chown todo-backend -R 10001:10001 /data
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
├── pulsar.yaml              the Forge manifest: the one file to edit about the app
├── manifest.json            what Core installs from (manifestVersion 2): pulsar.yaml
│                            rendered by scripts/render_manifest.py, never edited by hand
├── docker-compose.yml       both services, private beside Core, without Forge
├── .github/workflows/       release.yml (a tag, through Forge), docker-publish.yml
├── .env.example             every setting, documented
├── cobalt/                  optional saved copy of Core's public keys
├── dev/fake_core.py         a local stand-in for Core, for development
├── backend/                 FastAPI service
│   ├── main.py              routes; every data route needs Core's identity
│   ├── auth.py              verifies Core's JWT, names the permissions
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
    ├── Dockerfile           the gateway image: builds the UI, nginx without root on 8080
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
cd frontend && pnpm install && pnpm dev
```

The frontend uses pnpm 10 (`npm install --global pnpm@10.34.5`), because
Forge's release workflow installs with `pnpm install --frozen-lockfile`.

Open `http://localhost:5173`. `DEV_ACCESS=read` makes you a read-only user,
`DEV_USER_ID` and `DEV_USERNAME` change who you are. Stop it with Ctrl+C.

Tests:

```bash
python -m pytest backend/tests
```

```bash
cd frontend && pnpm test && pnpm build
```

One backend test checks that `manifest.json` is exactly `pulsar.yaml` rendered.
It needs forge-sdk, which is not on a public index yet, and is skipped without
it. With a Forge checkout beside this one:

```bash
pip install -e ../forge/packages/forge-sdk
```

```bash
python scripts/render_manifest.py
```

Run the second command after every change to `pulsar.yaml`. Check the bundle
with `forge validate .` from the same checkout.

After adding or removing a key, update the key inventory
(`frontend/translations/todo-translation-keys.csv`) and rebuild its workbook;
a test fails until the code, the inventory and the workbook agree:

```bash
cd frontend && pnpm translation-keys
```

## API

All under the backend's `/api`; through Core, under `/apps/todo/api`.

| Method | Path | Needs |
|---|---|---|
| GET | `/api/todos` | `todo.todo.read` - this user's todos, newest first; `?computer_id=N` for one computer's |
| POST | `/api/todos` | `todo.todo.all` - `{ "title", "computer_id"? }` |
| PUT | `/api/todos/{id}` | `todo.todo.all` - title and/or done |
| DELETE | `/api/todos/{id}` | `todo.todo.all` |
| GET | `/api/predefined-lists` | `todo.todo.read` - this user's predefined lists, newest first |
| POST | `/api/predefined-lists` | `todo.todo.all` - `{ "name", "items": [...] }` |
| PUT | `/api/predefined-lists/{id}` | `todo.todo.all` - name and/or items |
| DELETE | `/api/predefined-lists/{id}` | `todo.todo.all` |
| GET | `/api/me` | any valid token - who is calling, and `can_write` |
| GET | `/api/health` | open |
| GET | `/api/manifest` | open - Core installs from it |
| GET | `/api/openapi.json` | open |

Core names permissions `<app>.<tab>.<action>`: Read on the `todo` tab is
`todo.todo.read`, All adds `todo.todo.all`. Another user's todo or list answers
404, not 403, so ids reveal nothing.

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

Core reads `id`, `name`, `description`, `version` and the **`core`** section -
the permission tabs the app consumes (`todo`), the role names it may be told
(none) and its token lifetime (180 s) - and checks that every entry in
`permissions` is Read or All on one of those tabs. Where the app runs is never
in the manifest: Core takes it from `COBALT_APP_URL_TODO`, so shipping a
manifest cannot redirect Core's traffic. The `frontend` section is for the ITSM
shell.

**`navigation`** uses the grouped contract: one group, labelled by the key
`todo` and linking to the To do List, with two children that both belong to
this one plugin:

| Label | Path | Permission | Sub tab |
|---|---|---|---|
| `todo-list` | `/plugins/ui/todo` | `todo:read` | `list` |
| `predefined-todo-list` | `/plugins/ui/todo/predefined` | `todo:read` | `predefined` |

Both load the same federated module; the sub-path below the plugin's root
(`''` or `/predefined`) tells it which page to render (see below). The Core
draws every label and translates it; see
[Page labels](#page-labels-and-the-panels-page-gate).

**`contributes`** puts this plugin into Core pages, at the extension targets
the Core defines. The Core decides where each renders, orders, loads, mounts,
updates and unmounts them:

| id | Target | Exposed module | Tab |
|---|---|---|---|
| `computer-todo-action` | `computer.details.header.actions` | `./ComputerTodoAction` | - |
| `computer-todo-tab` | `computer.details.tabs` | `./ComputerTodoTab` | label `todo` (a key), `fa-square-check` |

A contribution carries no permission: the panel shows it to everyone who
holds the Core's computers tab (Forge ADR-09), and the Forge manifest has no
field for one. So the header action hides itself: it stays hidden until
`GET /me` says the user may add todos. The tab shows the list to readers,
without the add form when they cannot write; a user with no access to the app
at all sees the API's refusal there. The tab's label is a key: the Core draws
the tab and translates it.

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
`pnpm translation-keys` with no dependency, for whoever prepares the rows
of the translation database. Neither is a catalog. Nothing the plugin ships
imports them.

`pnpm test` fails when:

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
The labels the Core draws are keys too: `todo` for the group and for the
Computer Details tab, `todo-list` and `predefined-todo-list` for the two
pages.

> `todo`, `todo-list`, `predefined-todo-list` and `todo.*` do not start with
> `plugin.`, which is the namespace the Core's documents reserve for plugins
> (`plugin.<id>.<key>`); by those documents a key without that prefix is a
> key of the Core. Whoever adds the rows must check that none of these keys
> is already in use, above all `todo`.

#### Page labels and the panel's page gate

The two page labels are keys, and each page names its own `subTab`, so Core
gives it a sub tab of its own, `todo-<subTab>`: `todo-list` and
`todo-predefined`. The label no longer has to be the tab's name for Core.

The panel still has one use of the label left over: its page gate takes the
label, exactly as written, as the page's tab name (`api/fetchPlugins.ts`,
`pageOfGroup`) and looks it up in the user's `allowed_tabs`:

| Label | The panel's gate looks for | Core's sub tab |
|---|---|---|
| `todo-list` | `todo-list` | `todo-list` |
| `predefined-todo-list` | `predefined-todo-list` | `todo-predefined` |

So until the panel gates a page on the tab Core returns for it (itsm-front,
branch `forge-panel-fixes`), the Predefined page is hidden by the panel even
from users Core lets in. The test suite keeps an open `todo` for it.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `COBALT_CORE_JWKS_URL` | - | Backend: Core's public keys (one of these two is required) |
| `COBALT_CORE_JWKS_FILE` | - | Backend: a saved copy of them |
| `COBALT_ISSUER` | `cobalt-core` | Backend: must equal Core's `CORE_JWT_ISSUER` |
| `COBALT_TENANT_ID` | any | Backend: must equal Core's `CORE_TENANT_ID` |
| `COBALT_AUDIENCE` | `todo` | Backend: this app's key in Core |
| `COBALT_PERMISSION_TAB` | `todo` | Backend: the Core tab its permissions hang off |
| `CORE_HOSTNAME` | - | Compose: Core's name, mapped to this machine in the backend container |
| `TODO_BIND_ADDRESS` / `TODO_PORT` | `127.0.0.1` / `8080` | Compose: where Core reaches the gateway |
| `TODO_DATA_FILE` | `backend/todos.json` (Docker: `/data/todos.json`) | Backend storage: todos |
| `TODO_PREDEFINED_FILE` | `backend/predefined_lists.json` (Docker: `/data/predefined_lists.json`) | Backend storage: predefined lists |
| `MANIFEST_PATH` | `manifest.json` at the repo root (Docker: `/app/manifest.json`, in the image) | `/api/manifest` |
| `TODO_BACKEND_URL` | `http://backend:8000` | Gateway: where nginx hands `/api/` |
| `VITE_API_TARGET` | `http://127.0.0.1:8001` | `pnpm dev` proxy (the fake Core) |

## Releases (Forge)

A release is a tag. Set the version in `pulsar.yaml` (`metadata.version` and
both services' `tag`), run `python scripts/render_manifest.py`, commit, then
tag `v<version>`. [`release.yml`](.github/workflows/release.yml) checks the tag
against `pulsar.yaml` and calls Forge's shared workflow
(`ISOFT-LTD/forge/.github/workflows/app-release.yml@main`). That builds both
images from the repository root, scans them, waits for the Release Manager's
approval in the `production` environment, signs the release record and
publishes `ghcr.io/itec-git/apps/todo-backend`, `ghcr.io/itec-git/apps/todo-frontend`
and `ghcr.io/itec-git/todo/release:<version>`. A server then installs it with
`forge install`. The images build the same way by hand:

```bash
docker build -f backend/Dockerfile -t ghcr.io/itec-git/apps/todo-backend:1.3.0 .
```

```bash
docker build -f frontend/Dockerfile -t ghcr.io/itec-git/apps/todo-frontend:1.3.0 .
```

Under Forge the app runs as the compose project `forge-todo`, with a volume of
its own (`forge-todo_todo-data`). Moving a server from `docker-compose.yml` to
Forge therefore means: copy `todos.json` and `predefined_lists.json` from the
old volume into the new one, owned by uid 10001; stop this compose project; and
remove `COBALT_APP_URL_TODO` from Core's environment, because it wins over the
address `forge install` registers.

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
still builds both images on every pull request and pushes the `main` branch's
to GHCR (`:main`, `:sha-<short>`) for testing. It no longer runs on tags.

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
