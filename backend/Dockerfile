# Todo backend - FastAPI API only. Serves no frontend assets.
# Build context is this folder:  docker build -t todo-backend ./backend
FROM python:3.13-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TODO_DATA_FILE=/data/todos.json \
    MANIFEST_PATH=/app/manifest.json

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# manifest.json lives at the repository root, outside this build context.
# Mount it at MANIFEST_PATH (docker-compose.yml does); without it,
# GET /api/manifest returns 404 and everything else works normally.

# todos.json lives on a volume so todos survive container rebuilds.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# Exactly one worker. The JSON store is guarded by an in-process lock, so a
# second worker would be a second process writing the same file unguarded.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
