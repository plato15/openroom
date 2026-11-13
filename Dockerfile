# Openroom for your own server. The same app as the Cloudflare Worker, run on Node with a
# SQLite file for the database and a folder (or any S3-compatible bucket) for the files.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Only what the server needs, plus esbuild to bundle it (no Wrangler or test tools).
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund esbuild@0.28.2
COPY scripts ./scripts
COPY src ./src
RUN npm run build:node

FROM node:24-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY public ./public
COPY migrations ./migrations
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "--enable-source-maps", "dist/server.mjs"]
