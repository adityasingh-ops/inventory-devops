# Stage 1: install production dependencies only
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: small runtime image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# patch OS packages and remove npm (not needed at runtime, avoids extra CVEs)
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY migrations ./migrations
# run as the built-in non-root "node" user
USER node
EXPOSE 3000
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
