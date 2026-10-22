# Todo frontend - the built UI, and the app's single entry point for Core.
# Build context is this folder:  docker build -t todo-frontend ./frontend
#
# nginx serves the standalone page, remoteEntry.js and the federated TodoApp
# module, and forwards /api/ to the backend (nginx.conf.template). That makes
# this container the one address Core needs: COBALT_APP_URL_TODO points here.

# Stage 1 - build the assets with Vite.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

# Stage 2 - static files, plus the /api/ hand-off to the backend.
FROM nginx:1.27-alpine
COPY --from=build /build/dist /usr/share/nginx/html
# The image renders /etc/nginx/templates/*.template into conf.d at startup.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# The backend as this container sees it; docker-compose.yml names it.
ENV TODO_BACKEND_URL=http://todo-backend:8000
EXPOSE 80
