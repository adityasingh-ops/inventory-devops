# Inventory App — DevOps Capstone (Node.js)

A small inventory tracker: add items, change their quantity, delete them.
The app is kept small on purpose. The point of the project is the DevOps pipeline around it.

```text
Developer → Git/GitHub → GitHub Actions (test → build → Trivy scan → push to GHCR → deploy)
                                                                       ↓
                         Terraform → AWS VPC + EKS → Helm → Ingress → frontend (Nginx) → backend (Node) → Postgres
                                                                       ↓
                                                         Prometheus → Grafana   (+ HPA autoscaling)
```

| Layer          | Tool                                     | Where                          |
| -------------- | ---------------------------------------- | ------------------------------ |
| Frontend       | Vanilla JS + Vite, served by Nginx       | `frontend/`                    |
| Backend        | Node.js + Express                        | `backend/src/`                 |
| Database       | PostgreSQL + SQL migrations              | `backend/migrations/`          |
| Tests          | Jest + Supertest (DB is mocked)          | `backend/tests/`               |
| Containers     | Docker (multi-stage, non-root), Compose  | `*/Dockerfile`, `docker-compose.yml` |
| CI/CD          | GitHub Actions                           | `.github/workflows/ci-cd.yml`  |
| Security       | Trivy image scan                         | in the workflow                |
| Registry       | GitHub Container Registry (GHCR)         | in the workflow                |
| Infrastructure | Terraform (VPC + EKS)                    | `terraform/`                   |
| Kubernetes     | Namespace, Deployments, Services, Ingress, HPA | `k8s/`, `helm/inventory/` |
| Monitoring     | Prometheus + Grafana (kube-prometheus-stack) | `monitoring/`, `helm/inventory/templates/monitoring.yaml` |
| Troubleshooting| Deliberately broken manifests            | `troubleshooting/`             |

## API

| Method | Path              | What it does                               |
| ------ | ----------------- | ------------------------------------------ |
| GET    | `/health`         | liveness: is the process up?               |
| GET    | `/ready`          | readiness: can it reach the database?      |
| GET    | `/metrics`        | Prometheus metrics                         |
| GET    | `/api/items`      | list items                                 |
| GET    | `/api/items/:id`  | get one item                               |
| POST   | `/api/items`      | create `{ "name": "Laptop", "quantity": 5 }` |
| PUT    | `/api/items/:id`  | update an item                             |
| DELETE | `/api/items/:id`  | delete an item                             |

---

# How to test everything, step by step

Work through these in order. Each step builds on the one before it.
📸 marks a screenshot the grading rubric asks for.

### Tools you need

```bash
brew install node git gh helm kubectl minikube terraform awscli
# and Docker Desktop (start it before running any docker command)
```

## 1. Unit tests (Jest)

```bash
cd backend
npm install
npm test          # 8 tests, all should pass
```

📸 the passing test output.

The tests mock `src/db.js`, so they never touch a real database.
Break one on purpose to see what fails: change `toBe(200)` to `toBe(500)` and run `npm test` again.

## 2. Full stack with Docker Compose

```bash
docker compose up --build
```

The backend is published on host port **4000** (it listens on 3000 inside the container).

| Open                                   | You should see                |
| -------------------------------------- | ----------------------------- |
| http://localhost:8080                  | the Inventory UI. Add an item |
| http://localhost:4000/health           | `{"status":"ok"}`             |
| http://localhost:4000/ready            | `{"status":"ready"}`          |
| http://localhost:4000/api/items        | JSON list of items            |
| http://localhost:4000/metrics          | Prometheus metrics            |

Test the API from the terminal:

```bash
curl -X POST localhost:4000/api/items -H 'Content-Type: application/json' -d '{"name":"Laptop","quantity":5}'
curl localhost:4000/api/items
curl -X PUT localhost:4000/api/items/1 -H 'Content-Type: application/json' -d '{"name":"Laptop","quantity":9}'
curl -X DELETE localhost:4000/api/items/1
```

Look at the database table directly:

```bash
docker compose exec postgres psql -U inventory -c 'SELECT * FROM items;'
docker compose exec postgres psql -U inventory -c 'SELECT * FROM schema_migrations;'
```

Check that the containers run as non-root:

```bash
docker compose exec backend whoami     # node
docker compose exec frontend whoami    # nginx
```

Stop with `docker compose down` (add `-v` to also delete the DB data).

📸 `docker compose up` running, and the browser at localhost:8080.

## 3. Git + GitHub

```bash
git init            # skip if already done
git add .
git commit -m "Add inventory app with full DevOps pipeline"
gh repo create inventory-devops --public --source=. --push
```

Use clear commit messages (for example "Add HPA for backend", not "update").
The rubric wants at least 10 commits, so commit each change as you make it.

## 4. CI/CD + Trivy + GHCR

Pushing to `main` runs the pipeline. Open the **Actions** tab on GitHub:

1. **test**: `npm test` and the frontend build. If a test fails, the pipeline stops here.
2. **build-scan-push**: builds both images, scans them with **Trivy** (fails on fixable HIGH/CRITICAL CVEs), then pushes them to `ghcr.io/<you>/inventory-backend:<commit-sha>`.
3. **deploy**: runs `helm upgrade` on EKS. It skips itself until you add the AWS secrets in step 6.

After the first green run, go to your GitHub profile → **Packages**. For **each** of the two packages, open
**Package settings → Change visibility → Public**, so Kubernetes can pull them without a password.

📸 the green pipeline, the Trivy output (expand the scan step), and the GHCR package page showing SHA tags.

To show that CI catches bugs: break a test, push, and watch the pipeline go red before any image is built.

## 5. Kubernetes + Helm locally (minikube, free)

Do everything here on your laptop before you spend money on AWS.

```bash
minikube start --cpus 4 --memory 6g
minikube addons enable ingress
minikube addons enable metrics-server        # needed by the HPA

# 5a. Monitoring first, so the ServiceMonitor CRD exists before the app is installed
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/prometheus-values.yaml

# 5b. Build the images inside minikube
minikube image build -t inventory-backend:local ./backend
minikube image build -t inventory-frontend:local ./frontend

# 5c. Deploy the app
kubectl apply -f k8s/namespace.yaml
helm upgrade --install inventory ./helm/inventory -n inventory -f helm/inventory/values-local.yaml
```

Check it:

```bash
kubectl get pods -n inventory       # 2 backend, 2 frontend, 1 postgres, all Running   📸
kubectl get svc -n inventory        # 📸
kubectl get ingress -n inventory
kubectl get hpa -n inventory
helm list -n inventory              # 📸
```

Open it through the Ingress. Run this in a **separate terminal** and leave it running:

```bash
minikube tunnel
```

Then open **http://localhost**: `/` goes to the frontend and `/api` goes to the backend. 📸

### HPA (autoscaling)

```bash
kubectl get hpa -n inventory -w                         # terminal 1: watch
URL=http://localhost/api/items ./scripts/load-test.sh   # terminal 2: load
```

When backend CPU goes above 50%, REPLICAS climbs from 2 toward 5, then drops back a few minutes after the load stops.

### Prometheus + Grafana

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
# http://localhost:9090/targets → find "serviceMonitor/inventory/backend", it should be UP   📸

kubectl port-forward -n monitoring svc/monitoring-grafana 3001:80
# http://localhost:3001  (login admin / admin)
# Dashboards → "Inventory App": requests/sec, p95 latency, errors, CPU   📸
```

Run the load test again and watch the graphs move.

Screenshot of the `/metrics` output:

```bash
kubectl port-forward -n inventory svc/backend 3000:3000
curl localhost:3000/metrics | grep http_requests_total     # 📸
```

### Troubleshooting lab

```bash
# Lab 1: bad image
kubectl apply -f troubleshooting/broken-image.yaml
kubectl get pods -n inventory                   # STATUS = ImagePullBackOff
kubectl describe pod -n inventory -l app=broken-image   # Events: "not found"
kubectl delete -f troubleshooting/broken-image.yaml

# Lab 2: Service whose selector matches no pods
kubectl apply -f troubleshooting/broken-service.yaml
kubectl get endpoints -n inventory broken-service       # <none>: no pods match
kubectl get pods -n inventory --show-labels             # compare the labels
kubectl delete -f troubleshooting/broken-service.yaml
```

Other useful commands: `kubectl logs -n inventory deploy/backend`, `kubectl get events -n inventory --sort-by=.lastTimestamp`.

Rollback with Helm: `helm history inventory -n inventory`, then `helm rollback inventory 1 -n inventory`.

## 6. AWS with Terraform (real cluster, costs money)

> ⚠️ EKS + NAT gateway + 2 × t3.medium costs about **$5–6 per day**. Run `terraform destroy` as soon as you have your screenshots.

```bash
aws configure                      # your IAM user's keys (never put them in git)
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan                     # 📸
terraform apply                    # about 15 minutes
$(terraform output -raw configure_kubectl)     # points kubectl at EKS
kubectl get nodes                  # 2 nodes Ready
cd ..
```

📸 AWS Console: VPC → `inventory-vpc`, and EKS → `inventory-eks` (region ap-south-1).

Install the cluster add-ons, then the app (it uses the GHCR images that CI pushed):

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
helm install metrics-server metrics-server/metrics-server -n kube-system
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/prometheus-values.yaml

kubectl apply -f k8s/namespace.yaml
helm upgrade --install inventory ./helm/inventory -n inventory \
  -f helm/inventory/values-eks.yaml \
  --set backend.image=ghcr.io/<your-github-username>/inventory-backend \
  --set frontend.image=ghcr.io/<your-github-username>/inventory-frontend \
  --set backend.tag=<commit-sha> --set frontend.tag=<commit-sha>

kubectl get ingress -n inventory   # ADDRESS = an AWS load balancer hostname; open it in the browser 📸
```

All the `kubectl`, HPA, Grafana and troubleshooting checks from step 5 work the same way here.

### Auto-deploy from CI (the live demo)

On GitHub, go to repo → Settings → Secrets and variables → Actions, and add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
The workflow assumes region `ap-south-1` and cluster `inventory-eks`.
If you created the cluster with a different IAM user, also give that user access to the cluster.

**Live demo:** change the `<h1>` text in `frontend/index.html`, then commit and push.
Watch the pipeline (test → build → scan → push → deploy), then refresh the load balancer URL to see the new heading.
You can also run `kubectl get pods -n inventory -w` to watch the old pods get replaced.

### Tear down (do not skip!)

```bash
helm uninstall inventory -n inventory
helm uninstall ingress-nginx -n ingress-nginx   # deletes the AWS load balancer. Do this BEFORE destroy, or destroy gets stuck on the VPC
cd terraform && terraform destroy               # 📸
```

---

## Notes and trade-offs

- Postgres runs inside Kubernetes with a PersistentVolume, which is simple for a class demo. In production you would usually use Amazon RDS instead.
- The DB password lives in a Kubernetes Secret built from `values.yaml`. In production you would use AWS Secrets Manager or Sealed Secrets.
- Services are named `backend`, `frontend` and `postgres` in both Compose and Kubernetes. That is why the same `nginx.conf` (`proxy_pass http://backend:3000`) works in both places.
