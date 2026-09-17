# Todo frontend - static plugin assets only: the standalone page,
# remoteEntry.js and the federated TodoApp module. No FastAPI, no database.
# Build context is this folder:  docker build -t todo-frontend ./frontend

# Stage 1 - build the assets with Vite.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

# Stage 2 - plain static file server.
FROM nginx:1.27-alpine
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
