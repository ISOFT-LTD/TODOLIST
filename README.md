# todo-plugin-poc

> **This is a test app, not a product.** It exists to prove the plugin
> architecture for the future ITSM platform: an application with its own UI,
> API and data, living behind Cobalt Core. The Todo app itself is deliberately
> minimal and disposable.

## What this POC is

A small Todo List packaged the way a Cobalt Core application is:

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
logged in to Cobalt who holds the **todo** tab - Read to view, All to edit.
Every user has their own list.

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

It prints `Todo List (todo 1.1.0): registered` and a checklist. Installing
again after an upgrade is the same command. From a browser instead, as an
administrator: `POST /auth/applications/install` with this repository's
`manifest.json` as the body.

**6. Give people access.** SuperUser already holds every tab. For anyone else,
grant a role the **todo** tab on the roles screen: **Read** to view, **All** to
add, edit, tick and delete.

**7. Open it:** log in to Cobalt, then in the same browser go to
`https://<core-hostname>:3008/apps/todo/`.

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
│   ├── main.py              routes; every todo route needs Core's identity
│   ├── auth.py              verifies Core's JWT, names the permissions
│   ├── models.py            todos, scoped to their owner
│   ├── database.py          JSON file storage
│   ├── schemas.py
│   ├── cobalt_identity/     the SDK, copied from Cobalt_Api (see VENDORED.md)
│   └── tests/
└── frontend/                Vite app
    ├── src/todo-app.js      the UI, exposed as the federated ./TodoApp
    ├── src/core-sdk.js      the SDK the standalone page uses: calls through Core
    ├── src/main.js          the standalone page
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

## API

All under the backend's `/api`; through Core, under `/apps/todo/api`.

| Method | Path | Needs |
|---|---|---|
| GET | `/api/todos` | `todo.todo.read` - this user's todos, newest first |
| POST | `/api/todos` | `todo.todo.all` |
| PUT | `/api/todos/{id}` | `todo.todo.all` - title and/or done |
| DELETE | `/api/todos/{id}` | `todo.todo.all` |
| GET | `/api/me` | any valid token - who is calling, and `can_write` |
| GET | `/api/health` | open |
| GET | `/api/manifest` | open - Core installs from it |
| GET | `/api/openapi.json` | open |

Core names permissions `<app>.<tab>.<action>`: Read on the `todo` tab is
`todo.todo.read`, All adds `todo.todo.all`. Another user's todo answers 404,
not 403, so ids reveal nothing.

## Integration

### manifest.json

Core reads `id`, `name`, `description`, `version` and the **`core`** section -
the permission tabs the app consumes (`todo`), the role names it may be told
(none) and its token lifetime (180 s) - and checks that every entry in
`permissions` is Read or All on one of those tabs. Where the app runs is never
in the manifest: Core takes it from `COBALT_APP_URL_TODO`, so shipping a
manifest cannot redirect Core's traffic. The `frontend` section is for the ITSM
shell.

### Module Federation remote

| | |
|---|---|
| Remote name | `todo_plugin` |
| Entry | `remoteEntry.js` - through Core, `/apps/todo/remoteEntry.js` |
| Exposed module | `./TodoApp` |
| Shared dependencies | none |

```js
const { mount } = await loadRemote('todo_plugin/TodoApp');
const unmount = mount(containerElement, { sdk });
```

### SDK contract

The UI never imports Core code. Everything goes through the `sdk` passed to
`mount`; only `sdk.api` is used:

| Method | Example |
|---|---|
| `sdk.api.get(path)` | `sdk.api.get('/todos')` |
| `sdk.api.post(path, body)` | `sdk.api.post('/todos', { title })` |
| `sdk.api.put(path, body)` | `sdk.api.put('/todos/1', { done: true })` |
| `sdk.api.delete(path)` | `sdk.api.delete('/todos/1')` |

`path` is relative to the app's API. Each call resolves to the parsed JSON (or
`null`) and rejects with an `Error` whose message is safe to show.

- **The ITSM shell's SDK** must send `path` to
  `<Core>/apps/todo/api<path>` with `credentials: 'include'`, and never add a
  token of its own - Core adds the one this app verifies.
- **The standalone page** uses [`frontend/src/core-sdk.js`](frontend/src/core-sdk.js),
  which does exactly that relative to the page, and turns Core's 401 / 403 /
  502 into messages a person can act on.

The UI renders in a shadow root, so the shell's CSS and the app's cannot leak
into each other, and the build uses relative paths, so it works under
`/apps/todo/` or any other prefix.

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
| `TODO_DATA_FILE` | `backend/todos.json` (Docker: `/data/todos.json`) | Backend storage |
| `MANIFEST_PATH` | `manifest.json` at the repo root | `/api/manifest` |
| `VITE_API_TARGET` | `http://127.0.0.1:8001` | `npm run dev` proxy (the fake Core) |

## Published images (GHCR)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds both images and pushes them to GitHub Container Registry on a push to
`main` (`:main`, `:sha-<short>`) or a `v1.2.3` tag (`:1.2.3`, `:1.2`, `:latest`).
Pull requests build without pushing. New GHCR packages are private by default.

## Known limitations

Deliberate for a throwaway POC:

- **JSON file storage**, rewritten on every change; **one uvicorn worker**, since
  writes are serialised with an in-process lock (the image pins `--workers 1`).
  The replay cache for token ids is per process too, which is why one worker
  is also what the identity check expects.
- **Todos from before owners existed are not shown.** Each todo now belongs to
  one user; rows written by the earlier, unauthenticated version belong to
  nobody.
- **No menu entry in the ITSM panel yet.** itsm-front needs a sidebar item
  pointing at `/apps/todo/` (key `todo`, id 22, label `todo`, matching Core).
