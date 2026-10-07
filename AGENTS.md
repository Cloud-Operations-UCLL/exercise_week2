# AGENTS.md

Instructions for AI coding assistants (Claude Code, Copilot, Cursor, Codex and others) working in this repository.

## Who you are working with

This is a **student's assignment repository** for the course Cloud & Operations (UCLL). The student is learning to containerise an application, build it with GitHub Actions and run it on Kubernetes. AI use is allowed and encouraged, but the student must be able to explain everything they hand in, without AI.

So your job is not only to produce working files. It is to help the student understand them. Follow the course workflow: **intent, generate, read, validate, apply, verify, explain back.**

When you generate configuration (Dockerfile, workflow, manifests):

1. Restate the intent in one or two sentences and list your assumptions (namespace, image, tags, ports, storage) before you write anything.
2. Produce complete, minimal files. No features the assignment does not ask for unless the student asks.
3. After each file, briefly explain every top-level block, and give the exact commands to validate it (see *Validation* below).
4. Point out at least one thing in your output the student should double-check themselves, and why.
5. If you are unsure whether a field, flag, apiVersion or action input exists, say so and name the documentation page to check. Never invent fields.

If the student asks you to "just do everything", you may, but still end with a short summary of what each file does and a list of the decisions you made on their behalf, so they can review them.

## The assignment

Full text in [`README.md`](README.md). In short, the student adds:

| Path | Content |
| --- | --- |
| `Dockerfile`, `.dockerignore` | Repository root |
| `.github/workflows/*.yml` | Test, build and push the image to `ghcr.io` |
| `infra/` | Kubernetes manifests for the app and PostgreSQL, plus `infra/README.md` |

## Hard rules

- **Do not modify the application** (`src/`, `public/`, `test/`, `package.json`, `package-lock.json`) unless the student explicitly asks. The assignment is about everything around the app. The one exception is the visible text change in Part 4 of the README, which the student makes themselves.
- **Pin versions.** Base images, the PostgreSQL image, GitHub Actions (`uses:`) and Helm charts all get an explicit version. Never use `:latest` or an untagged image. App images are referenced by their Git SHA tag.
- **No secrets in files.** Never write a real password, token or kubeconfig into any file. Use obvious placeholders (`CHANGE_ME`) in example Secrets, and name them `*.example.yaml`. Real Secrets are created with `kubectl create secret` and never committed. Do not ask the student to paste real secrets into the chat.
- **CI builds, it does not deploy.** The GitHub Actions workflow must not contain `kubectl`, `helm upgrade`, a kubeconfig or any other cluster credentials. Deployment is done by the student with `kubectl apply` (and later in the course by Argo CD).
- **Do not run commands that change the cluster or a remote** (`kubectl apply`, `kubectl delete`, `helm install`, `git push`, `docker push`) unless the student asks you to in this session. Prefer proposing the command and letting the student run it. Read-only commands (`kubectl get`, `describe`, `logs`, `--dry-run=server`, `kubectl diff`) are fine.
- **Do not touch other namespaces** than `labqueue`, except to read. Never modify or delete the `default` Gateway in `envoy-gateway-system`: it serves the student's hostname.

## The application

Lab Queue: Node.js 24 + Express + PostgreSQL. Full reference: [`docs/application.md`](docs/application.md). Key facts:

| Fact | Value |
| --- | --- |
| Install / start / test | `npm ci --omit=dev` / `node src/index.js` / `npm test` (tests need no database) |
| Port | `8080` (env `PORT`) |
| Required env | `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Optional env | `DB_PORT` (5432), `DB_SSL` (false), `PORT` (8080), `APP_TITLE`, `APP_VERSION` (set at build time to the Git SHA) |
| Liveness | `GET /healthz`, never touches the database |
| Readiness | `GET /readyz`, 503 when the database is unreachable or during shutdown |
| Debug | `GET /api/info` returns version and hostname (pod name) |
| Runtime files | `package.json`, `node_modules/`, `src/`, `public/` |
| File system | Writes nothing, works with `readOnlyRootFilesystem: true` |
| Signals | Handles `SIGTERM` gracefully. Start with `node` directly as PID 1 (exec-form `CMD`), not via `npm start` or a shell. |
| Database | Creates its own table on startup (advisory-locked, safe with several replicas). Needs an empty database and a user that owns it. Retries the connection 10 times, 3 s apart, then exits with code 1. |
| Memory | About 80 MiB RSS. Leave headroom in the limit. |

## The cluster

Each student has their own single-node cluster. Do not assume anything else is installed.

| Fact | Value |
| --- | --- |
| Distribution | Talos Linux 1.14, Kubernetes 1.37, managed by Sidero Omni |
| Size | One node, 2 vCPU, 8 GB RAM, 40 GB disk, shared by everything |
| Access | `kubectl` through Omni with OIDC login (the student's kubeconfig). No SSH, no node shell. |
| Storage | `local-path` is the default StorageClass. Data lives on that one node. |
| Ingress | Gateway API with Envoy Gateway. GatewayClass `eg`. A Gateway `default` in namespace `envoy-gateway-system` listens on HTTP port 80 and accepts routes from all namespaces. |
| Hostnames | `NN.co.ucll.cloud` and `*.NN.co.ucll.cloud`, where NN is the student's number. DNS already exists. This app uses `labqueue.NN.co.ucll.cloud`. Ask the student for NN, do not guess it. |
| TLS | None on the Gateway; Cloudflare sits in front. Plain HTTP between Cloudflare and the node. |
| Not installed | No Ingress controller, no LoadBalancer implementation, no cert-manager, no metrics-server (so `kubectl top` does not work unless the student installs it). Use an HTTPRoute, not an Ingress, and a ClusterIP Service, not a LoadBalancer. |

Example HTTPRoute shape for this cluster:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: labqueue
  namespace: labqueue
spec:
  parentRefs:
    - name: default
      namespace: envoy-gateway-system
  hostnames:
    - labqueue.NN.co.ucll.cloud
  rules:
    - backendRefs:
        - name: labqueue
          port: 80
```

## Known pitfalls (check these in your own output)

- **`postgres:18` and newer mount the volume at `/var/lib/postgresql`**, not `/var/lib/postgresql/data`. With the old path the container refuses to start. For 17 and older, the old path is correct.
- `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are only applied on an empty data directory.
- **GHCR image names must be lowercase.** `github.repository` and `github.repository_owner` can contain capitals; lowercase them (for example with `docker/metadata-action`, which does this, or a shell step).
- The workflow needs `permissions: packages: write` (and `contents: read`) to push to GHCR with `GITHUB_TOKEN`. Pull requests from forks get a read-only token, so do not push on `pull_request`.
- A GHCR package is private by default. The cluster then needs an image pull secret, or the student makes the package public. Let the student decide and document it.
- Images built on an Apple Silicon laptop are `arm64`. Check the node's architecture (`kubectl get nodes -o wide`) before suggesting a local build for the cluster.
- With `readOnlyRootFilesystem: true`, `npm` wants to write logs and a cache in the home directory. Another reason to start with `node` directly.
- The Service `targetPort` is `8080`, and its selector must match the pod labels exactly.
- Liveness must not depend on the database. Use `/healthz` for liveness and `/readyz` for readiness.
- Requests and limits must fit on a 2 vCPU / 8 GB node together with PostgreSQL and the system pods.

## Validation

Suggest these after generating files, as appropriate:

```bash
docker build --build-arg APP_VERSION=local -t labqueue:local .
docker image inspect labqueue:local --format '{{.Size}} {{.Architecture}} {{.Config.User}}'
kubectl apply -f infra/ --recursive --dry-run=server
kubectl diff -f infra/ --recursive
kubectl explain deployment.spec.template.spec.securityContext
kubectl -n labqueue get pods,svc,endpoints,httproute
kubectl -n labqueue describe pod <pod>
kubectl -n labqueue logs <pod> --previous
```

For workflows, `actionlint` catches most syntax errors before you push.

## Style

- Plain, readable YAML. One resource per file or one file per component, the student decides; follow what is already in `infra/`.
- Comments only where they explain *why*, not what.
- Use the namespace `labqueue` and the label `app.kubernetes.io/name` consistently.
- Write in English, in short sentences. The student may not be a native speaker.
