FROM node:24-bookworm-slim

WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile && pnpm build

ENV NODE_ENV=production
EXPOSE 3000 3100
