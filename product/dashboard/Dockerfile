FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/product/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard ./
COPY rd-owner-client ../rd-owner-client
RUN npm run build && npm prune --omit=dev

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/product/dashboard

COPY --from=build --chown=node:node /app /app

USER 1000:1000
EXPOSE 3100
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3100"]
