# Run the app (serves the embedded UI at http://127.0.0.1:8120; needs `just db`)
run:
    go run ./cmd/leadsheet

# Named apart from the deployed stack's leadsheet-postgres, which can share the host.
# Start a local Postgres for development on 127.0.0.1:5433 (data kept in a docker volume)
db:
    @docker start leadsheet-dev-postgres >/dev/null 2>&1 || docker run -d --name leadsheet-dev-postgres \
        -e POSTGRES_USER=leadsheet -e POSTGRES_PASSWORD=leadsheet -e POSTGRES_DB=leadsheet \
        -p 127.0.0.1:5433:5432 -v leadsheet-pgdata:/var/lib/postgresql/data postgres:17-alpine >/dev/null
    @until docker exec leadsheet-dev-postgres pg_isready -U leadsheet -q; do sleep 0.5; done
    @sleep 1 # on first boot, pg_isready passes during initdb's temporary server
    @until docker exec leadsheet-dev-postgres pg_isready -U leadsheet -q; do sleep 0.5; done
    @echo "postgres up: postgres://leadsheet:leadsheet@127.0.0.1:5433/leadsheet"

# Run the backend for the dev loop (pair with `just ui-dev`). OAuth
# callbacks go through the Vite server so the session cookie lands there.
dev: db
    go run ./cmd/leadsheet --debug --public-url http://127.0.0.1:3004

# Run the Vite dev server (http://127.0.0.1:3004, proxies /api and /oauth to :8120)
ui-dev:
    cd ui && pnpm install && pnpm dev

# Build the frontend into ui/dist
ui-build:
    cd ui && pnpm install && pnpm build && touch dist/.gitkeep

# Build the binary with version info (frontend included via go:embed)
build:
    #!/usr/bin/env bash
    set -euo pipefail
    just ui-build
    GIT_COMMIT=$(git rev-parse --short HEAD)
    BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    LDFLAGS="-X github.com/jazware/leadsheet.fm/version.GitCommit=${GIT_COMMIT} -X github.com/jazware/leadsheet.fm/version.BuildTime=${BUILD_TIME}"
    echo "Building leadsheet (commit: ${GIT_COMMIT})..."
    go build -ldflags "${LDFLAGS}" -o bin/leadsheet ./cmd/leadsheet

# Re-run the relay backfill (every repo with fm.leadsheet.* records)
backfill:
    go run ./cmd/leadsheet --backfill

# Run the UI's unit tests (ChordPro and chord-tag markup conversion)
ui-test:
    cd ui && pnpm install && pnpm test

# Regenerate pkg/store/dbq from pkg/store/queries.sql and the migrations
sqlc:
    go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

# Run tests against a throwaway Postgres (each test gets its own database)
test:
    #!/usr/bin/env bash
    set -euo pipefail
    docker rm -f leadsheet-test-postgres >/dev/null 2>&1 || true
    docker run -d --rm --name leadsheet-test-postgres -e POSTGRES_PASSWORD=test \
        -p 127.0.0.1:5434:5432 --tmpfs /var/lib/postgresql/data postgres:17-alpine >/dev/null
    trap 'docker rm -f leadsheet-test-postgres >/dev/null' EXIT
    until docker exec leadsheet-test-postgres pg_isready -U postgres -q; do sleep 0.5; done
    sleep 1 # pg_isready reports ready during initdb's temporary server
    until docker exec leadsheet-test-postgres pg_isready -U postgres -q; do sleep 0.5; done
    LEADSHEET_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5434/postgres?sslmode=disable go test ./...

# Format code
fmt:
    go fmt ./...

# Run linter
lint:
    golangci-lint run

# Clean up built binaries
clean:
    rm -rf bin/

# --- Deploying (docker compose) --------------------------------------------

# Build and start the app + Postgres. Reads env/leadsheet.env, decrypting it
# from env/leadsheet.enc.env with sops first when that exists.
up:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f env/leadsheet.enc.env ]; then sops decrypt env/leadsheet.enc.env > env/leadsheet.env; fi
    test -f env/leadsheet.env || { echo "env/leadsheet.env missing (see env/leadsheet.env.example)"; exit 1; }
    export GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
    export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    docker compose --env-file env/leadsheet.env -f build/docker-compose.yml up --build -d

# Stop the app and Postgres (the database volume is kept)
down:
    docker compose --env-file env/leadsheet.env -f build/docker-compose.yml down

# Follow the app and database logs
logs:
    docker compose --env-file env/leadsheet.env -f build/docker-compose.yml logs -f --tail 100

# psql into the deployed database
psql:
    docker exec -it leadsheet-postgres psql -U leadsheet leadsheet

# --- Lexicons (published by the @leadsheet.fm account) --------------------

goat := "go run github.com/bluesky-social/goat@v0.2.5"

# Check the fm.leadsheet.* schemas for syntax and style problems
lex-lint:
    {{goat}} lex lint lexicons/fm

# Publish new/changed fm.leadsheet.* schemas as com.atproto.lexicon.schema
# records. Needs _lexicon.leadsheet.fm TXT "did=<the account's DID>" and an app
# password: GOAT_USERNAME=leadsheet.fm GOAT_PASSWORD=... just lex-publish
lex-publish *args:
    {{goat}} lex publish {{args}} lexicons/fm

# Show whether the published schemas match the local ones
lex-status:
    {{goat}} lex status lexicons/fm
