# syntax=docker/dockerfile:1

# The Todo backend: the FastAPI API only, it serves no frontend files. Build it from the
# repository root, the folder that holds pulsar.yaml and manifest.json:
#
#   docker build -f backend/Dockerfile -t ghcr.io/itec-git/apps/todo-backend:<version> .
#
# Forge's release workflow builds it the same way. Nothing secret goes into the image: Core's
# settings (audience, issuer, tenant, JWKS) arrive as environment variables when it runs.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TODO_DATA_FILE=/data/todos.json \
    TODO_PREDEFINED_FILE=/data/predefined_lists.json \
    MANIFEST_PATH=/app/manifest.json

# A user of its own: the app never runs as root.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin app

WORKDIR /app/backend

# Packages first, so a code change does not reinstall them.
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

# What Core reads at GET /api/manifest: pulsar.yaml rendered (scripts/render_manifest.py).
COPY manifest.json /app/manifest.json
COPY backend/ ./

# The JSON stores live on a volume so data survives a new release. The folder belongs to the
# app's user before VOLUME, so a new volume starts out writable by it.
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

USER app
EXPOSE 8000

# The same request Core polls. The image has no curl or wget, so it is Python.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]

# Exactly one worker. The JSON store is guarded by an in-process lock, and cobalt_identity keeps
# its replay store in the process, so a second worker would write the same file unguarded and
# accept a token the first one has already seen.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-server-header"]
