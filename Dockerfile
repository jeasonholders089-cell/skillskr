# Production image for Zeabur (or any container host).
# The app only needs Node 24: node:sqlite, type stripping and process.loadEnvFile.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/data/app.db

WORKDIR /app

# Dependencies first so a code change does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the build context. `.dockerignore` keeps secrets, node_modules
# and local data out, and this form tolerates optional directories such as
# `packs/` (which only exists once real skill packs are authored).
COPY . .

# The database lives on a mounted volume; create it so a fresh container starts.
RUN mkdir -p /data /app/packs && chown -R node:node /data /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
