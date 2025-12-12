# https://depot.dev/docs/container-builds/optimal-dockerfiles/node-pnpm-dockerfile


FROM node:24 AS build
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm fetch
COPY package.json ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --offline
COPY . .
RUN pnpm build


FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app
VOLUME /data
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    DATABASE_URL=sqlite:/data/data.sqlite
COPY --from=build --chown=appuser:appgroup /app ./
ENTRYPOINT ["node", "dist/index.js"]
