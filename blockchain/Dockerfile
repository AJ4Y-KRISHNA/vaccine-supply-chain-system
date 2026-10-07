FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 ./docker-entrypoint.sh
EXPOSE 8545
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
