# Lab Queue: application reference

Lab Queue is a small help queue for lab sessions. A student adds their name and question, and a lecturer marks the ticket as helped. It is a Node.js web app (Express) backed by a PostgreSQL database.

You do not need to change the application to complete the assignment. This document tells you everything you need to run it: what it needs from its environment, which endpoints it exposes and how it behaves when things go wrong.

## At a glance

| What | Value |
| --- | --- |
| Language and runtime | JavaScript on Node.js 24 (LTS). Node 22 or newer works. |
| Dependencies | `express`, `pg`, declared in `package.json` and pinned in `package-lock.json` |
| Install dependencies | `npm ci` (or `npm ci --omit=dev` for production; there are no dev dependencies) |
| Start command | `node src/index.js` (same as `npm start`) |
| Tests | `npm test`. No database needed. |
| Listens on | Port `8080` by default, all interfaces |
| Database | PostgreSQL 16 or newer. Tested with PostgreSQL 18. |
| Files the app needs at runtime | `package.json`, `node_modules/`, `src/`, `public/` |
| Writes to disk | Nothing. The container file system can be read-only. |
| Logs | Plain text to stdout and stderr, one line per request |

## Environment variables

All configuration comes from environment variables. There is no config file, and nothing is hard-coded, so the same image runs on your laptop, in CI and in Kubernetes.

| Variable | Required | Default | Description | Secret? |
| --- | --- | --- | --- | --- |
| `DB_HOST` | yes | | Hostname of the PostgreSQL server. In Kubernetes this is usually the name of the database Service, for example `postgres`. | no |
| `DB_PORT` | no | `5432` | Port of the PostgreSQL server | no |
| `DB_NAME` | yes | | Name of the database | no |
| `DB_USER` | yes | | Database user | sensitive |
| `DB_PASSWORD` | yes | | Password of the database user | **yes** |
| `DB_SSL` | no | `false` | `true` to connect to PostgreSQL over TLS (needed for most managed cloud databases) | no |
| `PORT` | no | `8080` | Port the web server listens on | no |
| `APP_TITLE` | no | `Lab Queue` | Title shown in the web page | no |
| `APP_VERSION` | no | `dev` | Version string shown in the page footer and on `/api/info`. Set it at **build time** to the Git commit SHA or tag, so you can see which build is running. | no |

The "Secret?" column is a hint for Kubernetes: non-secret values belong in a ConfigMap (or directly in the Deployment), secret values belong in a Secret.

If a required variable is missing or a value is invalid, the app prints a clear error and exits with code 1:

```text
Configuration error: Missing required environment variable(s): DB_HOST, DB_PASSWORD. See docs/application.md for what the app expects.
```

At startup the app logs its configuration with the password masked, so `kubectl logs` shows you what it actually received:

```text
Starting Lab Queue with config: {"port":8080,"appTitle":"Lab Queue","appVersion":"3f2c1ab","db":{"host":"postgres","port":5432,"database":"labqueue","user":"labqueue","ssl":false,"password":"***"}}
```

A template for local development is in [`.env.example`](../.env.example).

## The database

The app needs **one PostgreSQL database and one user that owns it** (or at least has the right to create tables in the `public` schema). It does not need a superuser.

The app creates its own schema. On every start it runs `CREATE TABLE IF NOT EXISTS tickets (...)`, so you only have to provide an empty database. You do not run any SQL scripts yourself.

The schema migration is protected by a PostgreSQL advisory lock. When several replicas start at the same time, one creates the table and the others wait, so scaling the Deployment to multiple replicas is safe.

### Running PostgreSQL with the official image

The official `postgres` image creates the user and database for you on first start, based on its own environment variables. Map them to the app's variables like this:

| `postgres` image | Lab Queue app |
| --- | --- |
| `POSTGRES_USER` | `DB_USER` |
| `POSTGRES_PASSWORD` | `DB_PASSWORD` |
| `POSTGRES_DB` | `DB_NAME` |

Notice that both containers need the same password. In Kubernetes, that means both can read it from the same Secret.

These `POSTGRES_*` variables are only used when the data directory is **empty**. If you change the password later, the existing database keeps the old one. To start over, delete the data (in Kubernetes: the PersistentVolumeClaim).

### Where PostgreSQL keeps its data (watch out with version 18)

The data must survive a restart of the database pod, so it has to live on a volume.

| Image version | Mount the volume at |
| --- | --- |
| `postgres:18` and newer | `/var/lib/postgresql` |
| `postgres:17` and older | `/var/lib/postgresql/data` |

From version 18 on, the image stores its data in `/var/lib/postgresql/18/docker` and expects the volume one level higher, at `/var/lib/postgresql`. Most tutorials, and most AI answers, still use `/var/lib/postgresql/data`. With version 18 that mount makes the container refuse to start. Check the image documentation for the version you pin.

## HTTP endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /` | The web interface |
| `GET /healthz` | **Liveness.** Returns `200 {"status":"ok"}` as long as the process can answer. Never touches the database. |
| `GET /readyz` | **Readiness.** Returns `200` when the database answers `SELECT 1`, and `503` when the database is unreachable or the app is shutting down. |
| `GET /api/info` | Title, version, Node.js version and **hostname** of the container that answered. In Kubernetes the hostname is the pod name, so refreshing shows you load balancing across replicas. |
| `GET /api/tickets` | All tickets. Add `?status=open` or `?status=resolved` to filter. |
| `POST /api/tickets` | Create a ticket. JSON body: `{"student": "Ada", "question": "My pod is Pending"}` |
| `POST /api/tickets/:id/resolve` | Mark a ticket as helped |

Why two health endpoints? If the database goes down, restarting the app does not help, so liveness must not depend on the database. Readiness does, so Kubernetes stops sending traffic to a pod that cannot do its work. Think about which endpoint goes to which probe.

## Startup and shutdown behaviour

What happens when the app starts:

1. It reads and validates the environment variables. Invalid: exit with code 1.
2. It tries to reach the database up to **10 times, 3 seconds apart** (about 30 seconds in total). It logs every failed attempt with the reason, for example `password authentication failed` or `getaddrinfo ENOTFOUND postgres`.
3. Still no database after 10 attempts: exit with code 1. In Kubernetes you see this as a restart and eventually `CrashLoopBackOff`. Read the logs, the reason is there.
4. It creates the schema if needed, then starts listening and logs `Lab Queue <version> listening on port 8080`.

This means the app and the database can start in any order. If the database comes up within about 30 seconds, the app simply waits for it.

When the app receives `SIGTERM` (Kubernetes sends this when it stops a pod) it immediately reports not ready on `/readyz`, finishes the requests that are still running, closes the database connections and exits with code 0. If that takes longer than 10 seconds, it forces an exit.

For this to work in a container, the Node.js process must receive the signal. Start it directly (`CMD ["node", "src/index.js"]`) rather than through `npm start` or a shell, which do not always pass signals on. A quick check: `docker stop` should return in about a second, not after a 10-second timeout.

## Resource usage

Measured locally, as a starting point for your requests and limits. Measure it yourself in your cluster before you settle on values.

| | Idle | Light load (a few hundred requests) |
| --- | --- | --- |
| Memory (process RSS) | about 80 MiB | about 80 MiB |
| CPU | close to 0 | well under 100m |

Kubernetes counts the memory of the whole container (including file cache), which can be higher than the process alone. Do not set the memory limit right at 80 MiB.

## Running it on your laptop (without building an image)

You need Node.js 24 and Docker.

Start a throwaway PostgreSQL:

```bash
docker run -d --name labqueue-db -e POSTGRES_USER=labqueue -e POSTGRES_PASSWORD=changeme -e POSTGRES_DB=labqueue -p 5432:5432 postgres:18
```

If port 5432 is already in use on your laptop, use for example `-p 55432:5432` and set `DB_PORT=55432`.

Create your local environment file and install the dependencies:

```bash
cp .env.example .env
npm ci
```

Start the app in watch mode (it loads `.env` automatically):

```bash
npm run dev
```

Open http://localhost:8080. Run the tests with `npm test`.

Clean up afterwards:

```bash
docker rm -f labqueue-db
```

## Project layout

```text
.
├── src/
│   ├── index.js     Entry point: config, database wait, migration, server, shutdown
│   ├── config.js    Reads and validates the environment variables
│   ├── db.js        Connection pool, schema migration, wait-for-database
│   └── app.js       HTTP routes, health checks
├── public/          Static web interface (HTML, CSS, JS)
├── test/            Tests (node:test), use a fake database
├── docs/            This documentation
├── infra/           Your Kubernetes manifests and other infrastructure files
├── package.json
└── package-lock.json
```
