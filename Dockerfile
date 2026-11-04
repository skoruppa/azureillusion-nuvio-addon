# Self-hosted AzureIllusion Napisy: addon and fonts service in one Node.js process.
FROM node:22-alpine
WORKDIR /app

# Only the fonts service has runtime dependencies (harfbuzzjs).
COPY fonts/package.json fonts/package-lock.json fonts/
RUN cd fonts && npm ci --omit=dev && npm cache clean --force

# The root package.json marks src/*.js as ES modules.
COPY package.json ./
COPY src src
COPY fonts/api fonts/api
COPY fonts/lib fonts/lib
COPY fonts/substitutes fonts/substitutes
COPY selfhost selfhost

ENV NODE_ENV=production PORT=7000
EXPOSE 7000
USER node
CMD ["node", "selfhost/server.mjs"]
