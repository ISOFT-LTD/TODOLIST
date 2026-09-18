# todo-plugin-poc

> **This is a test plugin, not a product.** It exists only to prove the plugin
> architecture for the future ITSM platform. The Todo app is deliberately
> minimal and disposable — expect it to be thrown away once the architecture is
> validated.

## What this POC is

A small Todo List packaged the way a future ITSM plugin will be:

- a **FastAPI microservice** that owns its own API and data
- a **frontend exposed through Module Federation**, so the ITSM React shell can
  load it at runtime without rebuilding
- a **`manifest.json`** describing the plugin to the host
- **two independent Docker images** from this one repository: a frontend image
  that serves only the plugin assets, and a backend image that runs only the API

In the target architecture the browser never talks to the Todo service
directly:

```
Plugin UI (inside the ITSM React shell)
        │  sdk.api.get('/todos')
        ▼
Core SDK  ──►  Core FastAPI
                 • authenticates the user's HttpOnly session
                 • checks the plugin permissions
                 • looks up the plugin's backend in the plugin registry
                 │
                 │  server-to-server request
                 ▼
               Todo FastAPI (this repo)  ──►  /data/todos.json
```

The plugin knows nothing about cookies, credentials, CORS, the Core URL, or
the Todo service URL. It only calls the SDK it is given.

## Project structure

```
.
├── backend/
│   ├── main.py            FastAPI app: routes + manifest endpoint
│   ├── models.py          Todo record and CRUD over the JSON store
│   ├── schemas.py         Pydantic request/response schemas
│   ├── database.py        JSON file storage (read, atomic write, init)
│   ├── requirements.txt
│   ├── Dockerfile         Backend image: FastAPI only
│   └── .dockerignore
├── frontend/
│   ├── index.html         Standalone page
│   ├── src/
│   │   ├── todo-app.js    The plugin UI, exposed as mount(el, { sdk })
│   │   ├── styles.css     Scoped to a shadow root
│   │   ├── dev-sdk.js     Local SDK for standalone development only
│   │   └── main.js        Standalone entry point
│   ├── public/
│   ├── vite.config.js     Module Federation remote + dev proxy
│   ├── package.json
│   ├── Dockerfile         Frontend image: static assets only (nginx)
│   └── .dockerignore
├── manifest.json          Plugin manifest
└── docker-compose.yml     Runs both images side by side
```

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker with Compose v2 (only for the Docker option)

## Run locally

Run the backend and frontend in two terminals.

### FastAPI backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

- API: http://localhost:8000/api/todos
- Interactive docs: http://localhost:8000/docs

Run it from inside `backend/` — the modules import each other by plain name.
Data is written to `backend/todos.json`, created as `[]` on first start.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Standalone, the plugin is mounted with the local
development SDK ([`frontend/src/dev-sdk.js`](frontend/src/dev-sdk.js)), whose
`sdk.api` calls the Todo FastAPI directly on the same origin. The Vite dev
server proxies `/api` to the backend on port 8000, so no backend URL is
hardcoded.

```
Browser → Vite :5173 → dev-sdk.js → Vite /api proxy → FastAPI :8000 → todos.json
```

To produce the plugin assets (`frontend/dist`, including `remoteEntry.js`):

```bash
npm run build
```

## Docker

The frontend and backend are separate images. Each builds only from its own
folder and runs without the other.

### Frontend image

Serves only static assets with nginx: the standalone page, `remoteEntry.js`,
and the federated `TodoApp` module. No FastAPI, no database, no volume.

```bash
docker build -t todo-frontend ./frontend
docker run --rm -p 8080:80 todo-frontend
```

- Plugin entry: http://localhost:8080/remoteEntry.js

The standalone page at http://localhost:8080 renders, but cannot load todos on
its own: its local SDK calls `/api` on the same origin, and this container has
no API. For standalone CRUD, use the local development flow above.

### Backend image

Runs only FastAPI. Serves no frontend assets.

```bash
docker build -t todo-backend ./backend
docker run --rm -p 8000:8000 \
  -v todo-data:/data \
  -v "$(pwd)/manifest.json:/app/manifest.json:ro" \
  todo-backend
```

- API: http://localhost:8000/api/todos

Todos are stored at `/data/todos.json`. Keep the `/data` volume and the data
survives removing and recreating the container. `manifest.json` lives at the
repository root, outside the backend build context, so it is mounted in; without
that mount `GET /api/manifest` returns `404` and everything else works.

### Both, with Docker Compose

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| `todo-frontend` | http://localhost:8080 |
| `todo-backend` | http://localhost:8000 |

Todos survive `docker compose restart` and `docker compose down` / `up`, because
they live on the `todo-data` named volume, which only the backend uses. To wipe
the data:

```bash
docker compose down -v
```

### Published images (GHCR)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds both images and pushes them to GitHub Container Registry:

| Trigger | Tags |
|---|---|
| Push to `main` | `main`, `sha-<short>` |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-<short>` |
| Pull request | build only, nothing pushed |

```bash
docker pull ghcr.io/zoughaib-sally/todo-backend:main
docker pull ghcr.io/zoughaib-sally/todo-frontend:main
```

New GHCR packages are private by default; make them public (or grant access)
under the package settings on GitHub before pulling without a login.

## API endpoints

| Method | Path | Description | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/todos` | List todos, newest first | `200` | |
| `POST` | `/api/todos` | Create a todo — body `{"title": "..."}` | `201` | `422` blank title |
| `PUT` | `/api/todos/{id}` | Update title and/or done — body `{"title"?, "done"?}` | `200` | `404`, `422` |
| `DELETE` | `/api/todos/{id}` | Delete a todo | `204` | `404` |
| `GET` | `/api/health` | Liveness probe | `200` | |
| `GET` | `/api/manifest` | Returns `manifest.json` | `200` | `404`, `500` |

A Todo looks like:

```json
{ "id": 1, "title": "Example task", "done": false }
```

Titles are trimmed; empty or whitespace-only titles are rejected with `422`.

## Plugin integration

### manifest.json

Lives at the **repository root**: [`manifest.json`](manifest.json). It is:

- mounted into the backend container at `/app/manifest.json`
- served at runtime from `GET /api/manifest` on the backend, so the ITSM core
  can discover the plugin without reading its files

It declares the plugin id, navigation entry, API root, the SDK capabilities
the plugin needs (`frontend.sdk`), and the Module Federation remote details.
`backend.port` and `frontend.port` are the container ports of the two
separate services.

### Module Federation remote

| | |
|---|---|
| Remote name | `todo_plugin` |
| Entry | `remoteEntry.js` (served from the root of the frontend service) |
| Exposed module | `./TodoApp` |
| Shared dependencies | none |

The remote exposes a framework-agnostic function rather than a React component,
so the plugin does not bundle or share React with the shell:

```js
const { mount } = await loadRemote('todo_plugin/TodoApp');

const unmount = mount(containerElement, { sdk });

// later
unmount();
```

### SDK contract

The plugin never imports Core code. Every connection goes through the SDK the
host passes to `mount`. Only `sdk.api` is used for now:

| Method | Example call from the plugin |
|---|---|
| `sdk.api.get(path)` | `sdk.api.get('/todos')` |
| `sdk.api.post(path, body)` | `sdk.api.post('/todos', { title })` |
| `sdk.api.put(path, body)` | `sdk.api.put('/todos/1', { done: true })` |
| `sdk.api.delete(path)` | `sdk.api.delete('/todos/1')` |

- `path` is relative to the plugin's API root (`backend.apiRoot` in the
  manifest, `/api`).
- Each method resolves to the parsed JSON response, or `null` when there is no
  body, and rejects with an `Error` whose message is safe to show the user.
- `mount` throws immediately if `sdk.api` is missing any of these methods.

Two implementations exist:

- **Core's SDK (production)** — sends the call to Core FastAPI, which
  authenticates, checks permissions, and forwards it server-to-server to
  `<registered backend><apiRoot><path>`.
- **Local SDK (standalone development)** —
  [`frontend/src/dev-sdk.js`](frontend/src/dev-sdk.js) calls `/api<path>` on
  the same origin. It is imported only by the standalone entry, never by the
  federated module.

Because the plugin depends only on this contract, Core can refactor freely, and
the plugin could later move into an iframe by changing only the SDK
implementation.

The UI renders inside a shadow root, so the shell's global CSS cannot restyle
the plugin and the plugin's CSS cannot leak into the shell. Build output uses
relative paths, so `remoteEntry.js` works behind any proxy prefix.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `TODO_DATA_FILE` | `backend/todos.json` (Docker: `/data/todos.json`) | Backend storage path |
| `MANIFEST_PATH` | `manifest.json` at the repo root (Docker: `/app/manifest.json`) | `/api/manifest` |
| `VITE_API_TARGET` | `http://localhost:8000` | Dev proxy target for `npm run dev` |

## Known limitations

These are deliberate for a throwaway POC:

- **JSON file storage.** The whole file is rewritten on every change. Fine for
  testing, not for real data volume.
- **Single uvicorn worker only.** Writes are serialized with an in-process lock;
  running more than one worker could lose updates. The backend image pins
  `--workers 1`.
- **No authentication.** The plugin trusts its caller. In the target
  architecture the ITSM core authenticates the user before proxying requests.
