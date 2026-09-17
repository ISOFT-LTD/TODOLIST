# Stage 1 - build the static frontend with Vite.
FROM node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 - FastAPI service that also serves the built frontend.
FROM python:3.13-slim
WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TODO_DATA_FILE=/data/todos.json \
    FRONTEND_DIST=/app/frontend/dist \
    MANIFEST_PATH=/app/manifest.json

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY manifest.json /app/manifest.json
COPY --from=frontend-build /build/dist /app/frontend/dist

# todos.json lives on a volume so todos survive container rebuilds.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# Exactly one worker. The JSON store is guarded by an in-process lock, so a
# second worker would be a second process writing the same file unguarded.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
