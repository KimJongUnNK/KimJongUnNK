FROM node:22-alpine
WORKDIR /app
COPY package.json server.js worker.js ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
EXPOSE 8787
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server.js"]
