FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.finance.json ./
RUN npm ci
COPY server ./server
COPY src/shared ./src/shared
COPY src/i18n ./src/i18n
COPY scripts/finance-*.ts scripts/database-archive.ts ./scripts/
COPY server-tests/finance ./server-tests/finance
RUN npm run build:finance && npx esbuild scripts/finance-migrate.ts scripts/finance-smoke.ts scripts/finance-multi-smoke.ts scripts/finance-tls-smoke.ts scripts/finance-deposits.ts scripts/finance-deposit-smoke.ts --bundle --platform=node --external:pg --external:pg-native --format=esm --outdir=dist-finance-tools

FROM node:22-bookworm-slim
ENV NODE_ENV=development FINANCE_MODE=simulation
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server/finance.js ./dist-server/finance.js
COPY --from=build /app/dist-finance-tools ./dist-finance-tools
COPY --from=build /app/server/finance/role-safety.sql ./finance-assets/role-safety.sql
USER node
EXPOSE 2570
CMD ["node", "dist-server/finance.js"]
