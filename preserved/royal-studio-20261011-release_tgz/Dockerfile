FROM golang:1.27.2-bookworm AS cards
WORKDIR /cards
COPY server/card-engine ./
RUN CGO_ENABLED=0 go build -trimpath -o /card-engine .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=cards /card-engine ./dist-server/card-engine
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 2567
CMD ["node", "dist-server/index.js"]
