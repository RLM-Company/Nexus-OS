FROM node:24-bookworm-slim

WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

ENV NODE_ENV=production
EXPOSE 3000 3100
