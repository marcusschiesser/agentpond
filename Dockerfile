FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
ENV CI=true
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/ingest/package.json apps/ingest/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/duckdb/package.json packages/duckdb/package.json
RUN pnpm install --frozen-lockfile --filter agentpond --filter agentpond-ingest... --filter agentpond-cli...

FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/ingest/src/index.ts"]
