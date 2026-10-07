FROM node:20-alpine

WORKDIR /workspace/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
RUN mkdir -p /workspace/blockchain/artifacts

ENV NODE_ENV=development
EXPOSE 5000 5100
CMD ["node", "server.js"]
