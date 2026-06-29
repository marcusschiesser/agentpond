FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# pnpm deploy needs legacy mode because this workspace does not use injected workspace packages.
RUN pnpm --filter @agentpond/ingest-service deploy --legacy --prod /prod

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
LABEL org.opencontainers.image.source="https://github.com/marcusschiesser/agentpond"
LABEL org.opencontainers.image.description="AgentPond Langfuse-compatible ingestion service"
LABEL org.opencontainers.image.licenses="MIT"
RUN addgroup -S agentpond && adduser -S agentpond -G agentpond
COPY --from=build --chown=agentpond:agentpond /prod ./apps/ingest
USER agentpond
EXPOSE 3000
CMD ["node", "apps/ingest/dist/index.js"]
