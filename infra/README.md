# Infrastructure

This folder is yours. Put everything here that is needed to run Lab Queue on your cluster: Kubernetes manifests, a Helm chart or Kustomize files, and example Secrets with placeholders.

Fill in this README as you go. Someone who has your repository and an empty cluster must be able to deploy the application by following it, without asking you anything.

## Suggested layout

You may organise it differently. If you do, explain why.

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

Real Secrets are **not** committed. `.gitignore` already blocks files with `secret` in their name under `infra/`, except `*.example.yaml`. Check `git status` before every commit anyway.

---

<!-- Everything below this line is yours to fill in. Remove the hints in italics. -->

## Deploying from scratch

*Prerequisites, then the exact commands in order: create the namespace, create the Secret (without the real value in this file!), apply the manifests, wait for the rollout. Include how to check that it worked.*

## Releasing a new version

*How a new commit ends up running in the cluster: where you find the new image tag, what you change, what you apply, how you watch the rollout.*

## Decisions

*Your choices and why, in a sentence or two each. For example: base image, image tags, how the cluster pulls from GHCR (public package or pull secret), how the Secret is created, resource requests and limits (and how you measured them), probe settings, StatefulSet versus Deployment for PostgreSQL.*

## Proof

*The output for each step of Part 4 in the assignment.*

## Problems I ran into

*What broke, how you found out (which command, which message), and how you fixed it.*
