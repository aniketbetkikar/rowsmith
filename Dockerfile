FROM node:22-slim
WORKDIR /app
RUN corepack enable
# Public URL baked into prerendered metadata (og:image needs an absolute URL).
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
EXPOSE 3000
