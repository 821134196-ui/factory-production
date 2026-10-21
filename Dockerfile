FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3188 DEMO_MODE=false \
    AUTH_MODE=sms OFFICIAL_ROSTER=true PRIVATE_DATA_DIR=/app/private-data \
    DB_PATH=/app/data/production.sqlite BACKUP_DIR=/app/backups TZ=Asia/Shanghai
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node scripts/backup.js ./scripts/backup.js
COPY --chown=node:node scripts/docker-entrypoint.js ./scripts/docker-entrypoint.js
COPY --chown=node:node scripts/replace-workbook-data.js ./scripts/replace-workbook-data.js
RUN mkdir -p /app/private-data /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 3188
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3188/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/docker-entrypoint.js"]
