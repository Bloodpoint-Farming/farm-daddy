# https://depot.dev/docs/container-builds/optimal-dockerfiles/node-pnpm-dockerfile


FROM node:24 AS build
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV npm_config_build_from_source=false
WORKDIR /app

# Download all dependencies from the lock file into the docker build cache.
# Include the pnpm-workspace.yaml so it doesn't complain about ignored build scripts.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm fetch --frozen-lockfile

# Set up the node-modules needed to build the project
# Note that .npmrc is needed to "shamefully-hoist" to avoid symlinks
# so that all node-modules are installed to the top level
COPY package.json .npmrc ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

# Bring the src files everything else and compile the typescript
COPY . .
RUN pnpm build

# Remove dev dependencies, leave only prod node_modules
RUN --mount=type=cache,target=/pnpm/store \
    pnpm prune --prod


FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app
VOLUME /data
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    DATABASE_URL=sqlite:/data/data.sqlite
COPY --from=build --chown=appuser:appgroup /app ./
CMD [ "dist/index.js" ]
