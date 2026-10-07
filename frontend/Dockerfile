# syntax=docker/dockerfile:1

# The gateway, the one service Core talks to: nginx serves the built UI (the page, remoteEntry.js
# and the federated modules) and hands /api/ to the backend. pulsar.yaml calls it `frontend`.
# Build it from the repository root, the folder that holds pulsar.yaml:
#
#   docker build -f frontend/Dockerfile -t ghcr.io/itec-git/apps/todo-frontend:<version> .
#
# vite.config.js reads ../pulsar.yaml for the remote's name and modules, so the bundle and the
# manifest cannot disagree. Nothing secret goes into the image.

FROM node:22-alpine AS bundle
RUN npm install --global pnpm@10.34.5
WORKDIR /app/frontend
COPY pulsar.yaml /app/pulsar.yaml
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# nginx without root: the image runs as its own user and listens on 8080 (ADR-10).
FROM nginxinc/nginx-unprivileged:1.30-alpine
# The image fills in ${TODO_BACKEND_URL} from the environment when the container starts;
# pulsar.yaml sets it to http://backend:8000.
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=bundle /app/frontend/dist/ /usr/share/nginx/html/
ENV TODO_BACKEND_URL=http://backend:8000
EXPOSE 8080
