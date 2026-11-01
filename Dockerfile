# Roleplay20 game server for Fly.io. The client is built before deploying (scripts/cloud-setup.mjs runs the
# Vite build), so the image only needs Node and the three server packages.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY shared ./shared
COPY site ./site
COPY client/dist ./client/dist

# Saved games live on the Fly volume mounted at /data (see fly.toml). Secrets come from `fly secrets`.
ENV DATA_DIR=/data PORT=3020 TUNNEL=off
EXPOSE 3020
CMD ["node", "server/index.js"]
