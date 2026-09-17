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
- a **Docker image** that ships all of the above as one unit

In the target architecture the browser never talks to the plugin directly:

```
ITSM shell (React)  ──loads remoteEntry.js──┐
        │                                   │
        │ API calls (session cookie)        │
        ▼                                   ▼
ITSM core backend (FastAPI)  ──proxies /plugins/todo-plugin/*──►  this plugin (FastAPI)
                                                                        │
                                                                        ▼
                                                                  /data/todos.json
```

## Project structure

```
.
├── backend/
│   ├── main.py            FastAPI app: routes, CORS, manifest + static serving
│   ├── models.py          Todo record and CRUD over the JSON store
│   ├── schemas.py         Pydantic request/response schemas
│   ├── database.py        JSON file storage (read, atomic write, init)
│   └── requirements.txt
├── frontend/
│   ├── index.html         Standalone page
│   ├── src/
│   │   ├── todo-app.js    The plugin UI, exposed as mount(el, options)
│   │   ├── styles.css     Scoped to a shadow root
│   │   └── main.js        Standalone entry point
│   ├── public/
│   ├── vite.config.js     Module Federation remote + dev proxy
│   └── package.json
├── manifest.json          Plugin manifest
├── Dockerfile
└── docker-compose.yml
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

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend on
port 8000, so the frontend only ever calls the relative path `/api/todos` — no
backend URL is hardcoded.

To have FastAPI serve the frontend itself on port 8000 instead, build it once:

```bash
npm run build     # writes frontend/dist, which the backend serves at /
```

## Run with Docker Compose

```bash
docker compose up --build
```

Open http://localhost:8000. One container serves the API, the built frontend,
and `remoteEntry.js`.

Todos are stored at `/data/todos.json` on the `todo-data` named volume, so they
survive `docker compose restart` and `docker compose down` / `up`. To wipe the
data:

```bash
docker compose down -v
```

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

- copied into the Docker image at `/app/manifest.json`
- served at runtime from `GET /api/manifest`, so the ITSM core can discover the
  plugin without reading its files

It declares the plugin id, navigation entry, API prefix, and the Module
Federation remote details.

### Module Federation remote

| | |
|---|---|
| Remote name | `todo_plugin` |
| Entry | `remoteEntry.js` (served from the plugin root) |
| Exposed module | `./TodoApp` |
| Shared dependencies | none |

The remote exposes a framework-agnostic function rather than a React component,
so the plugin does not bundle or share React with the shell:

```js
const { mount } = await loadRemote('todo_plugin/TodoApp');

const unmount = mount(containerElement, {
  apiBase: 'https://<core>/plugins/todo-plugin/api/todos',
  credentials: 'include',   // send the shell's session cookie to the core
});

// later
unmount();
```

The UI renders inside a shadow root, so the shell's global CSS cannot restyle
the plugin and the plugin's CSS cannot leak into the shell. Build output uses
relative paths, so `remoteEntry.js` works behind any proxy prefix.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `TODO_DATA_FILE` | `backend/todos.json` (Docker: `/data/todos.json`) | Backend storage path |
| `CORS_ORIGINS` | `localhost:5173`, `localhost:3000` | Comma-separated origins allowed to call the backend directly |
| `MANIFEST_PATH` | `manifest.json` at the repo root (Docker: `/app/manifest.json`) | `/api/manifest` |
| `FRONTEND_DIST` | `frontend/dist` (Docker: `/app/frontend/dist`) | Static frontend serving |
| `VITE_API_TARGET` | `http://localhost:8000` | Dev proxy target for `npm run dev` |

## Known limitations

These are deliberate for a throwaway POC:

- **JSON file storage.** The whole file is rewritten on every change. Fine for
  testing, not for real data volume.
- **Single uvicorn worker only.** Writes are serialized with an in-process lock;
  running more than one worker could lose updates. The Docker image pins
  `--workers 1`.
- **No authentication.** The plugin trusts its caller. In the target
  architecture the ITSM core authenticates the user before proxying requests.
