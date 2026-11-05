FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DB_FILE=/data/ofie.db UPLOAD_DIR=/data/uploads PRIVATE_DIR=/data/private
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
