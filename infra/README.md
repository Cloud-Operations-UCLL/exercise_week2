# Infrastructure

Everything needed to run Lab Queue and PostgreSQL on the course cluster. This is the **example solution**: placeholders you must replace are listed under *Before you start*.

## Layout

```text
infra/
├── README.md
└── k8s/
    ├── namespace.yaml
    ├── postgres/
    │   ├── secret.example.yaml     # placeholders only, committed
    │   ├── service.yaml
    │   └── statefulset.yaml
    └── labqueue/
        ├── configmap.yaml
        ├── deployment.yaml
        ├── service.yaml
        └── httproute.yaml
```

Real Secrets are never committed. `.gitignore` blocks files with `secret` in their name under `infra/`, except `*.example.yaml`.

## Before you start

- `kubectl get nodes` shows one node that is `Ready`.
- The image is built by the pipeline: push to `main` and wait for a green run. The image is `ghcr.io/cloud-operations-ucll/exercise_week2_solution:<full git sha>`.
- Replace `NN` in `k8s/labqueue/httproute.yaml` with your student number.
- Replace `REPLACE_WITH_GIT_SHA` in `k8s/labqueue/deployment.yaml` with the SHA of the latest green run on `main`.
- The GHCR package must be public (see *Decisions*), or you need a pull secret.

## Deploying from scratch

1. Create the namespace:

   ```bash
   kubectl apply -f infra/k8s/namespace.yaml
   ```

2. Create the real Secret. The password is generated on the spot and never written to a file:

   ```bash
   kubectl -n labqueue create secret generic labqueue-db \
     --from-literal=username=labqueue \
     --from-literal=database=labqueue \
     --from-literal=password="$(openssl rand -base64 24)"
   ```

3. Validate, then apply. `secret.example.yaml` must **not** be applied: it would overwrite your real Secret with `CHANGE_ME`.

   ```bash
   kubectl apply -f infra/k8s/postgres/service.yaml -f infra/k8s/postgres/statefulset.yaml \
     -f infra/k8s/labqueue/ --dry-run=server
   kubectl apply -f infra/k8s/postgres/service.yaml -f infra/k8s/postgres/statefulset.yaml
   kubectl -n labqueue rollout status statefulset/postgres
   kubectl apply -f infra/k8s/labqueue/
   kubectl -n labqueue rollout status deployment/labqueue
   ```

4. Check it:

   ```bash
   kubectl -n labqueue get pods,svc,endpoints,httproute,pvc
   curl -s http://labqueue.NN.co.ucll.cloud/api/info
   ```

Starting from an empty cluster, this is the whole procedure. To test it, run `kubectl delete namespace labqueue` and repeat. This also deletes the database volume.

## Releasing a new version

1. Push to `main`. The pipeline tests, builds and pushes `ghcr.io/cloud-operations-ucll/exercise_week2_solution:<sha>`.
2. Copy the full commit SHA of the green run (Actions tab, or `git rev-parse HEAD`).
3. Put it in the `image:` line of `k8s/labqueue/deployment.yaml` and commit.
4. Apply and watch:

   ```bash
   kubectl apply -f infra/k8s/labqueue/deployment.yaml
   kubectl -n labqueue rollout status deployment/labqueue
   ```

5. The footer of the page shows the same SHA, because the pipeline passes it as `APP_VERSION`.

CI never touches the cluster. Deployment is a separate, deliberate step (later in the course: Argo CD).

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Base image | `node:24.21.0-alpine3.23` | Exact Node 24 LTS version, small. Alpine keeps the image well under 250 MB. |
| Dockerfile | Multi-stage, `npm ci --omit=dev`, `COPY package*.json` before `src/` | A change in `src/` or `public/` reuses the cached dependency layer. |
| Non-root and signals | `USER node`, `CMD ["node", "src/index.js"]` | No npm or shell in between, so `node` is PID 1 and gets `SIGTERM`. |
| `APP_VERSION` | Build arg, declared after the `COPY` steps | A new SHA does not invalidate earlier layers. |
| Actions | Pinned to full commit SHAs, with the version in a comment | A tag can be moved by the action's owner. A commit SHA cannot. |
| Workflow permissions | `contents: read` globally, `packages: write` on the build job only | Least privilege. Login to GHCR only happens on `push`. |
| Image tags | Full Git SHA, plus `main` | The SHA ties a running pod to a commit. Manifests never use `main` or `latest`. |
| Registry access | **Public** GHCR package | The course app has no secrets in the image. It avoids a pull secret and a token in the cluster. If your package must stay private, create a `docker-registry` Secret with a read-only token and add `imagePullSecrets` to the Deployment. |
| PostgreSQL | `postgres:18.6` StatefulSet, 1 replica, 2Gi PVC on `local-path` | A StatefulSet gives a stable identity and its own volume. Mounted at `/var/lib/postgresql`, as required from version 18. |
| Database Service | Headless ClusterIP `postgres` | Not exposed outside the cluster. The app reaches it as `postgres:5432`. |
| Secret | `labqueue-db`, created with `kubectl create secret` | Both PostgreSQL and the app read the same keys, so the passwords cannot drift apart. Proper secret management comes in lesson 5. |
| Probes | App: liveness `/healthz`, readiness `/readyz`. Database: `pg_isready` | Liveness must not depend on the database: restarting the app does not fix a database outage. Readiness does, so traffic stops going to a pod that cannot work. |
| Resources | App 50m/128Mi requests, 250m/256Mi limits. PostgreSQL 100m/256Mi requests, 500m/512Mi limits | The app uses about 80 MiB, so 256Mi leaves headroom. The total fits easily on 2 vCPU / 8 GB. Not measured here: metrics-server is not installed. Measure on your own cluster before you copy these. |
| Security context | Non-root (uid 1000), no privilege escalation, read-only root file system, all capabilities dropped, `RuntimeDefault` seccomp | The app writes nothing to disk. |
| Rollout | `maxUnavailable: 0`, `maxSurge: 1` | A new pod must be ready before an old one goes away, so the site stays up during a release. |

## Proof

Fill this in on your own cluster. For each step, paste the command and its output.

1. The site loads and a ticket can be added and resolved: screenshot of `http://labqueue.NN.co.ucll.cloud`.
2. The footer shows the commit SHA of the latest green run on `main`.
3. Load balancing over both replicas:

   ```bash
   for i in $(seq 1 10); do curl -s http://labqueue.NN.co.ucll.cloud/api/info; echo; done
   ```

4. Delete one app pod (pick a name from `kubectl -n labqueue get pods`): `kubectl -n labqueue delete pod <pod-name>`. Keep calling the site, and watch with `kubectl -n labqueue get pods -w`.
5. Delete the database pod: `kubectl -n labqueue delete pod postgres-0`. When it is back, the tickets are still there.
6. A full release, as described above, with `kubectl rollout status` output and the new SHA in the footer.
7. `kubectl -n labqueue scale statefulset/postgres --replicas=0`. Look at `/readyz`, the `READY` column and the website. Scale back with `--replicas=1`.

## Problems I ran into

Add your own here. Common ones:

- `ImagePullBackOff`: package still private, tag does not exist, or the name is not lowercase.
- PostgreSQL crashes right after start: volume mounted at `/var/lib/postgresql/data` instead of `/var/lib/postgresql` on version 18.
- `password authentication failed` after changing the Secret: `POSTGRES_PASSWORD` only applies to an empty data directory. Delete the PVC (`kubectl -n labqueue delete pvc data-postgres-0`) to start over.
- `exec format error`: image built on an arm64 laptop for an amd64 node. Let the pipeline build it.
