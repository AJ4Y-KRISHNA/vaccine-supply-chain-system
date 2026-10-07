FROM node:20-alpine AS build
WORKDIR /workspace/field-operator-panel
RUN corepack enable
COPY field-operator-panel/package.json field-operator-panel/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY field-operator-panel/ ./
# ShipmentMap reuses the framework-agnostic map factory and styles from the main frontend.
COPY frontend/src/components/ShipmentMap.css /workspace/frontend/src/components/ShipmentMap.css
COPY frontend/src/components/ShipmentMapFactory.js /workspace/frontend/src/components/ShipmentMapFactory.js
ARG VITE_BACKEND_API_URL=/api
ENV VITE_BACKEND_API_URL=${VITE_BACKEND_API_URL}
ENV VITE_BACKEND_WS_URL=
RUN pnpm build

FROM nginx:1.27-alpine
COPY field-operator-panel/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/field-operator-panel/dist /usr/share/nginx/html
EXPOSE 80
