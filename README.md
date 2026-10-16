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
| Infrastructure | Terraform (VPC + EKS; free mode = VPC only)                  | `terraform/`                   |
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
gh auth login                      # log in as adityasingh-ops (check with: gh auth status)
gh repo create inventory-devops --public --source=. --push
```

Use clear commit messages (for example "Add HPA for backend", not "update").
The rubric wants at least 10 commits, so commit each change as you make it.

## 4. CI/CD + Trivy + GHCR + Kubernetes deploy (all free)

Pushing to `main` runs the pipeline. Open the **Actions** tab on GitHub:

1. **test**: `npm test` and the frontend build. If a test fails, the pipeline stops here.
2. **build-scan-push**: builds both images, scans them with **Trivy** (fails on fixable HIGH/CRITICAL CVEs), then pushes them to `ghcr.io/adityasingh-ops/inventory-backend:<commit-sha>`.
3. **deploy**: creates a throwaway Kubernetes cluster (kind) inside the CI runner, runs `helm upgrade --install` with the new images, waits for the pods, then smoke-tests the API. It's free and needs no secrets.

After the first green run, go to your GitHub profile → **Packages**. For **each** of the two packages, open
**Package settings → Change visibility → Public**, so your minikube (step 5) can pull them.

📸 the green pipeline, the Trivy output (expand "Trivy scan"), the deploy step's `kubectl get pods` output, and the GHCR package page showing SHA tags.

To show that CI catches bugs: break a test, push, and watch the pipeline go red before any image is built.

## 5. Kubernetes + Helm on your laptop (minikube, free)

```bash
brew install minikube helm          # kubectl comes with Docker Desktop

# Docker Desktop → Settings → Resources: set Memory to 8 GB first (the default 4 GB is too small
# for the app + Prometheus/Grafana + a load test), then:
minikube start --cpus 4 --memory 6g
minikube addons enable ingress
minikube addons enable metrics-server        # needed by the HPA

# 5a. Monitoring first, so the ServiceMonitor CRD exists before the app is installed
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/prometheus-values.yaml

# 5b. Deploy the app with the images CI pushed to GHCR
kubectl apply -f k8s/namespace.yaml
./scripts/deploy-local.sh           # uses the latest commit SHA on origin/main
```

(Before you have pushed to GitHub, you can use locally built images instead:
`minikube image build -t inventory-backend:local ./backend`, the same for `frontend`, then
`helm upgrade --install inventory ./helm/inventory -n inventory -f helm/inventory/values-local.yaml`.)

Check it:

```bash
kubectl get pods -n inventory       # 2 backend, 2 frontend, 1 postgres, all Running   📸
kubectl get svc -n inventory        # 📸
kubectl get ingress -n inventory
kubectl get hpa -n inventory
helm list -n inventory              # 📸
```

Open it through the Ingress. Run this in a **separate terminal** and leave it running (it asks for your Mac password):

```bash
minikube tunnel
```

Then open **http://localhost**: `/` goes to the frontend and `/api` goes to the backend. 📸

### Live demo: commit → pipeline → deployment updates

1. Change the `<h1>` text in `frontend/index.html`.
2. `git commit -am "Change dashboard heading" && git push`
3. Show the Actions tab: test → build → Trivy → push → deploy, all green.
4. When it's done: `git pull && ./scripts/deploy-local.sh`. Watch `kubectl get pods -n inventory -w` as the old pods are replaced.
5. Refresh http://localhost to see the new heading. `helm history inventory -n inventory` shows a new revision.

Rollback: `helm rollback inventory <previous-revision> -n inventory`.

### HPA (autoscaling)

```bash
kubectl get hpa -n inventory -w     # terminal 1: watch
./scripts/load-test.sh              # terminal 2: a busybox pod hammers the backend for 3 minutes
```

When backend CPU goes above 50%, REPLICAS climbs from 2 toward 5, then drops back a few minutes after the load stops. 📸

### Prometheus + Grafana

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
# http://localhost:9090/targets → "serviceMonitor/inventory/backend" should be UP   📸

kubectl port-forward -n monitoring svc/monitoring-grafana 3001:80
# http://localhost:3001  (login admin / admin)
# Dashboards → "Inventory App": requests/sec, p95 latency, errors, CPU   📸
```

Run the load test again and watch the graphs move.

Screenshot of the `/metrics` output:

```bash
kubectl port-forward -n inventory svc/backend 4000:3000
curl localhost:4000/metrics | grep http_requests_total     # 📸
```

### Troubleshooting lab

```bash
# Lab 1: bad image
kubectl apply -f troubleshooting/broken-image.yaml
kubectl get pods -n inventory                           # STATUS = ErrImagePull / ImagePullBackOff
kubectl describe pod -n inventory -l app=broken-image   # Events explain why
kubectl delete -f troubleshooting/broken-image.yaml

# Lab 2: Service whose selector matches no pods
kubectl apply -f troubleshooting/broken-service.yaml
kubectl get endpoints -n inventory broken-service       # <none>: no pods match
kubectl get pods -n inventory --show-labels             # compare the labels
kubectl delete -f troubleshooting/broken-service.yaml
```

Other useful commands: `kubectl logs -n inventory deploy/backend`, `kubectl get events -n inventory --sort-by=.lastTimestamp`.

Stop everything with `minikube stop` (keeps the cluster) or `minikube delete` (removes it).

## 6. Terraform on AWS: the free demo

EKS and NAT gateways are **not** free tier. The default `terraform.tfvars.example` therefore sets
`create_eks = false` and `enable_nat_gateway = false`. Terraform then creates only the VPC, 2 public and 2 private subnets,
route tables and an internet gateway. Those cost **$0**.
`terraform plan` still shows the EKS design in code, and the app itself runs on Kubernetes in minikube and in CI.

### One-time AWS setup

1. Create a free AWS account. In **Billing → Budgets**, create a **$1 zero-spend budget** so AWS emails you if anything starts costing money.
2. In **IAM → Users → Create user** (for example `terraform`), attach the `AdministratorAccess` policy.
   Then go to **Security credentials → Create access key → CLI**.
3. On your Mac:

```bash
brew install terraform awscli
aws configure            # paste the access key + secret, region ap-south-1, output json
aws sts get-caller-identity     # should print your account id
```

The keys live in `~/.aws/credentials` and never go into git.

### Run it

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars    # create_eks = false, enable_nat_gateway = false
terraform init                                  # 📸
terraform plan                                  # 📸
terraform apply                                 # type "yes"
```

📸 AWS Console → **VPC** (region Mumbai / ap-south-1) → `inventory-vpc` with its 4 subnets.

```bash
terraform destroy                               # type "yes"   📸
cd ..
```

### Optional: the real EKS cluster (costs about $5–6 per day)

Only do this if you want an EKS screenshot, and destroy it the same day.
Set `create_eks = true` and `enable_nat_gateway = true` in `terraform.tfvars`, run `terraform apply` (about 15 minutes), and then:

```bash
$(terraform output -raw configure_kubectl)      # points kubectl at EKS
kubectl get nodes
```

Install the add-ons and the app:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
helm install metrics-server metrics-server/metrics-server -n kube-system
helm install monitoring prometheus-community/kube-prometheus-stack -n monitoring --create-namespace -f monitoring/prometheus-values.yaml
kubectl apply -f k8s/namespace.yaml
helm upgrade --install inventory ./helm/inventory -n inventory -f helm/inventory/values-eks.yaml \
  --set backend.image=ghcr.io/adityasingh-ops/inventory-backend --set backend.tag=$(git rev-parse HEAD) \
  --set frontend.image=ghcr.io/adityasingh-ops/inventory-frontend --set frontend.tag=$(git rev-parse HEAD)
kubectl get ingress -n inventory                # ADDRESS = load balancer URL
```

Then tear it down. Run `helm uninstall ingress-nginx -n ingress-nginx` **first**, because it deletes the AWS load balancer and otherwise destroy gets stuck. Then run `terraform destroy`.

---

## Notes and trade-offs

- Postgres runs inside Kubernetes with a PersistentVolume, which is simple for a class demo. In production you would usually use Amazon RDS instead.
- The DB password lives in a Kubernetes Secret built from `values.yaml`. In production you would use AWS Secrets Manager or Sealed Secrets.
- Services are named `backend`, `frontend` and `postgres` in both Compose and Kubernetes. That is why the same `nginx.conf` (`proxy_pass http://backend:3000`) works in both places.
