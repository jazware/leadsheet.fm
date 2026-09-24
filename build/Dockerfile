# Build context: the repo root (see docker-compose.yml).

# Stage 1: the web UI
FROM node:22-alpine AS ui-builder
WORKDIR /app/ui
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
RUN pnpm build

# Stage 2: the Go binary, with the UI embedded
FROM golang:1.26 AS builder
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
WORKDIR /app
COPY go.mod go.sum ./
COPY version ./version
COPY telemetry ./telemetry
RUN go mod download
COPY cmd ./cmd
COPY pkg ./pkg
COPY lexicons ./lexicons
COPY ui/embed.go ./ui/embed.go
COPY --from=ui-builder /app/ui/dist ./ui/dist
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-X github.com/jazware/leadsheet.fm/version.GitCommit=${GIT_COMMIT} -X github.com/jazware/leadsheet.fm/version.BuildTime=${BUILD_TIME}" \
    -o /leadsheet ./cmd/leadsheet

# Stage 3: runtime
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /leadsheet /usr/local/bin/leadsheet
ENV LEADSHEET_LISTEN_ADDRESS=0.0.0.0:8120
EXPOSE 8120
CMD ["leadsheet"]
