FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspace @earthora/api --include-workspace-root --no-audit --no-fund
COPY apps/api ./apps/api
RUN npm run build -w @earthora/api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspace @earthora/api --include-workspace-root --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/assets ./apps/api/assets
COPY apps/api/public ./apps/api/public
COPY apps/api/src/db/migrations ./apps/api/dist/db/migrations
WORKDIR /app/apps/api
EXPOSE 4100
CMD ["node", "dist/main.js"]
