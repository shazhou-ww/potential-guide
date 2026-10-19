ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends git procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
RUN npm install --global pnpm@11.22.0 --ignore-scripts --no-audit --no-fund
WORKDIR /source
COPY source.tar /source.tar
RUN tar -xf /source.tar -C /source && rm /source.tar
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --registry="${NPM_REGISTRY}"
COPY prepare-image.mjs /harness/prepare-image.mjs
COPY provenance.json /harness/provenance.json
RUN node /harness/prepare-image.mjs

FROM base AS runtime
COPY --from=build /opt/consumer /opt/consumer
COPY --from=build --chown=node:node /opt/objective /opt/objective
COPY --from=build /harness/provenance.json /harness/provenance.json
COPY fixture.mjs verify.mjs /harness/
RUN mkdir -p /work/home /work/runs && chown -R node:node /work
ENV HOME=/work/home
ENV PATH=/opt/consumer/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /work
USER node
CMD ["sleep", "infinity"]
