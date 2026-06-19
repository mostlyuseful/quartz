FROM node:22-slim AS builder
WORKDIR /usr/src/app
COPY package.json .
COPY package-lock.json* .
RUN npm ci

FROM node:22-slim
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/ /usr/src/app/
COPY . .
RUN mkdir -p /quartz-cache && chmod 1777 /quartz-cache
CMD ["npx", "quartz", "build", "--serve"]
