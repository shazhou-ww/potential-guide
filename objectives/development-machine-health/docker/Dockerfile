FROM rust:1.85-slim-bookworm AS rust

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
       ca-certificates git sudo python3 python3-venv g++ cmake ninja-build procps \
    && mkdir -p /var/lib/apt/periodic \
    && touch /var/lib/apt/periodic/update-success-stamp \
    && groupadd --gid 2000 agent \
    && useradd --uid 2000 --gid 2000 --create-home --shell /bin/bash agent \
    && printf 'agent ALL=(ALL:ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent \
    && mkdir -p /home/agent/work /home/agent/tmp /home/agent/cache \
       /home/agent/logs /home/agent/tasks \
    && chown -R agent:agent /home/agent

COPY typescript.tgz /tmp/typescript.tgz
RUN npm install --global --offline --no-audit /tmp/typescript.tgz \
    && rm /tmp/typescript.tgz

COPY --from=rust /usr/local/cargo /opt/cargo
COPY --from=rust /usr/local/rustup /opt/rustup
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
ENV HOME=/home/agent
COPY server.mjs /opt/health-fixture/server.mjs
USER agent
WORKDIR /home/agent
CMD ["node", "/opt/health-fixture/server.mjs"]
