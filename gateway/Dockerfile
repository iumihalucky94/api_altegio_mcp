# Build stage
FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install && npm run build

# Production: no Chromium (WhatsApp moved to wa-service)
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
EXPOSE 3030
CMD ["node", "dist/src/server.js"]
