FROM node:24-bookworm-slim AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN mkdir -p /data /artifacts && chown -R node:node /data /artifacts /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=2580 FACTORY_DATA=/data
EXPOSE 2580
CMD ["node", "server.mjs"]

FROM royal-ai-worker-runtime:0.1.0 AS worker
USER root
WORKDIR /app
COPY --from=app /app /app
RUN test -x /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex && ln -sf /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex /usr/local/bin/codex-linux-sandbox
RUN install -d -o root -g root -m 0755 /usr/local/lib/royal-codex/bin && install -o root -g root -m 0755 /app/deployment/bwrap /usr/local/lib/royal-codex/bin/bwrap
RUN mkdir -p /home/node/.codex /workspaces /data /artifacts /tmp/factory-test-home && chown -R node:node /home/node/.codex /workspaces /data /artifacts /app /tmp/factory-test-home
USER node
ENV NODE_ENV=production CODEX_HOME=/home/node/.codex WORKSPACES_DIR=/workspaces PROJECT_SOURCE=/project FACTORY_DATA=/data PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PATH="/usr/local/lib/royal-codex/bin:${PATH}"
CMD ["node", "worker.mjs"]
