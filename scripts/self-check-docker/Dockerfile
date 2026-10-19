ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
# Bootstrap HTTPS with the pinned Node image's public roots before installing system CAs.
RUN mkdir -p /etc/ssl/certs \
    && node -e "require('node:fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('node:tls').rootCertificates.join('\n'))" \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends git procps ca-certificates \
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

FROM base AS fixture-runtime
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

FROM fixture-runtime AS real-agent
USER root
ARG COPILOT_VERSION=1.0.98
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm install --global "@github/copilot@${COPILOT_VERSION}" --registry="${NPM_REGISTRY}" \
    --ignore-scripts --no-audit --no-fund && copilot --version
COPY real-agent.mjs /harness/real-agent.mjs
ENV COPILOT_AUTO_UPDATE=false
USER node

FROM fixture-runtime AS runtime
