FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/game-config/package.json packages/game-config/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
# Vite bakes these into the bundle and its CSP, so the image is tied to one public address.
ARG PUBLIC_DOMAIN
ENV VITE_API_URL=https://$PUBLIC_DOMAIN
ENV VITE_WS_URL=wss://$PUBLIC_DOMAIN/ws
RUN test -n "$PUBLIC_DOMAIN" && npm run build

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/game-config/package.json packages/game-config/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts && npm rebuild bcrypt
COPY --from=build /app/packages/game-config/dist packages/game-config/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
CMD ["node", "apps/api/dist/index.js"]

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/frontend/dist /srv
