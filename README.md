# Inventory App - DevOps Project

A small inventory app where you can add items, change their quantity and delete them.
The app is kept simple on purpose. The main work in this project is the DevOps setup around it:
Git, Docker, CI/CD, security scanning, Terraform, Kubernetes, Helm and monitoring.

## Flow

```text
Code change
  -> push to GitHub
  -> GitHub Actions: run tests, build Docker images, scan with Trivy, push to GHCR
  -> deploy with Helm to Kubernetes
  -> Prometheus collects metrics, Grafana shows them
```

Terraform creates the AWS network (VPC and subnets) and can also create an EKS cluster.

## Tech used

- Frontend: HTML, CSS and JavaScript built with Vite, served by Nginx
- Backend: Node.js with Express
- Database: PostgreSQL with SQL migration files
- Tests: Jest and Supertest (the database is mocked)
- Containers: Docker and Docker Compose
- CI/CD: GitHub Actions
- Security scan: Trivy
- Image registry: GitHub Container Registry (GHCR)
- Infrastructure: Terraform on AWS
- Kubernetes: Deployments, Services, Ingress, HPA, managed with a Helm chart
- Monitoring: Prometheus and Grafana (kube-prometheus-stack)

## Folder structure

```text
backend/              Express API, migrations and tests
frontend/             UI and Nginx config
docker-compose.yml    runs the full app locally
.github/workflows/    CI/CD pipeline
terraform/            AWS VPC and EKS
k8s/                  namespace
helm/inventory/       Helm chart for the app
monitoring/           Prometheus and Grafana settings
troubleshooting/      broken manifests for practice
scripts/              deploy and load test scripts
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | /health | app is running |
| GET | /ready | app can reach the database |
| GET | /metrics | Prometheus metrics |
| GET | /api/items | list all items |
| GET | /api/items/:id | get one item |
| POST | /api/items | create an item, body: {"name": "Laptop", "quantity": 5} |
| PUT | /api/items/:id | update an item |
| DELETE | /api/items/:id | delete an item |

---

## Setup

Install these first:

```bash
brew install node git gh helm kubectl minikube terraform awscli
```

Also install Docker Desktop and keep it running.

### 1. Run the tests

```bash
cd backend
npm install
npm test
```

All 8 tests should pass. The tests do not use a real database.

### 2. Run the app with Docker Compose

```bash
docker compose up --build
```

- App: http://localhost:8080
- Backend health: http://localhost:4000/health
- Backend items: http://localhost:4000/api/items
- Metrics: http://localhost:4000/metrics

The backend runs on port 3000 inside the container and is mapped to port 4000 on your machine.

Try the API:

```bash
curl -X POST localhost:4000/api/items -H 'Content-Type: application/json' -d '{"name":"Laptop","quantity":5}'
curl localhost:4000/api/items
curl -X PUT localhost:4000/api/items/1 -H 'Content-Type: application/json' -d '{"name":"Laptop","quantity":9}'
curl -X DELETE localhost:4000/api/items/1
```

Check the database:

```bash
docker compose exec postgres psql -U inventory -c 'SELECT * FROM items;'
```

Check that the containers do not run as root:

```bash
docker compose exec backend whoami
docker compose exec frontend whoami
```

Stop it with `docker compose down`. Use `docker compose down -v` to also delete the database data.

### 3. CI/CD pipeline

The workflow is in `.github/workflows/ci-cd.yml` and runs on every push to main. It has three jobs:

1. test: runs the backend tests and builds the frontend. If this fails, the pipeline stops.
2. build-scan-push: builds both Docker images, scans them with Trivy and pushes them to GHCR.
   Images are tagged with the commit SHA. The scan fails the pipeline on HIGH or CRITICAL issues that have a fix.
3. deploy: starts a temporary Kubernetes cluster (kind) inside GitHub Actions, installs the Helm chart
   with the new images and checks that the API works.

After the first successful run, open your GitHub profile, go to Packages, and change both packages
(inventory-backend and inventory-frontend) to Public. This lets minikube pull the images.

### 4. Kubernetes on your machine with minikube

In Docker Desktop, go to Settings > Resources and set Memory to 8 GB. 4 GB is not enough for the app and monitoring together.

Start the cluster:

```bash
minikube start --cpus 4 --memory 6g
minikube addons enable ingress
minikube addons enable metrics-server
```

Install Prometheus and Grafana first, so the app's ServiceMonitor can be created:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/prometheus-values.yaml
```

Deploy the app using the images from GHCR:

```bash
kubectl apply -f k8s/namespace.yaml
./scripts/deploy-local.sh
```

If you have not pushed to GitHub yet, you can build the images inside minikube instead:

```bash
minikube image build -t inventory-backend:local ./backend
minikube image build -t inventory-frontend:local ./frontend
helm upgrade --install inventory ./helm/inventory -n inventory -f helm/inventory/values-local.yaml
```

Check everything is running:

```bash
kubectl get pods -n inventory
kubectl get svc -n inventory
kubectl get ingress -n inventory
kubectl get hpa -n inventory
helm list -n inventory
```

You should see 2 backend pods, 2 frontend pods and 1 postgres pod.

To open the app through the Ingress, run this in a separate terminal and keep it open:

```bash
minikube tunnel
```

Then open http://localhost. Requests to / go to the frontend and requests to /api go to the backend.

### 5. Deploy a change

1. Change the heading in `frontend/index.html`.
2. Commit and push:
   ```bash
   git commit -am "Change page heading"
   git push
   ```
3. Wait for the pipeline to finish in the Actions tab.
4. Deploy the new version:
   ```bash
   git pull
   ./scripts/deploy-local.sh
   ```
5. Refresh http://localhost to see the change.

`helm history inventory -n inventory` shows each release. To go back to an older one:

```bash
helm rollback inventory <revision> -n inventory
```

### 6. Autoscaling (HPA)

Watch the HPA in one terminal:

```bash
kubectl get hpa -n inventory -w
```

Start the load test in another terminal:

```bash
./scripts/load-test.sh
```

The load test runs a pod inside the cluster that keeps calling the backend for 3 minutes.
When backend CPU goes over 50%, the number of backend pods goes up (max 5).
It goes back down a few minutes after the load stops.

### 7. Prometheus and Grafana

Prometheus:

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Open http://localhost:9090/targets. The target `serviceMonitor/inventory/backend` should show UP.

Grafana:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3001:80
```

Open http://localhost:3001 and log in with admin / admin.
Open the "Inventory App" dashboard. It shows requests per second, p95 latency, errors and CPU.
Run the load test again to see the graphs change.

Backend metrics directly:

```bash
kubectl port-forward -n inventory svc/backend 4000:3000
curl localhost:4000/metrics | grep http_requests_total
```

### 8. Troubleshooting practice

Wrong image tag:

```bash
kubectl apply -f troubleshooting/broken-image.yaml
kubectl get pods -n inventory
kubectl describe pod -n inventory -l app=broken-image
kubectl delete -f troubleshooting/broken-image.yaml
```

The pod shows ErrImagePull or ImagePullBackOff. The events in `describe` show that the image was not found.

Service with the wrong selector:

```bash
kubectl apply -f troubleshooting/broken-service.yaml
kubectl get endpoints -n inventory broken-service
kubectl get pods -n inventory --show-labels
kubectl delete -f troubleshooting/broken-service.yaml
```

The service has no endpoints because its selector does not match any pod labels.

Other useful commands:

```bash
kubectl logs -n inventory deploy/backend
kubectl get events -n inventory --sort-by=.lastTimestamp
```

When you are done, run `minikube stop`. Run `minikube delete` to remove the cluster completely.

### 9. Terraform on AWS (free option)

EKS and NAT gateways are not part of the AWS free tier. By default the example config creates only
the VPC, two public subnets, two private subnets and an internet gateway. These are free.

AWS account setup:

1. Create an AWS account.
2. In Billing > Budgets, create a zero spend budget so you get an email if anything starts costing money.
3. In IAM, create a user (for example `terraform`) with the AdministratorAccess policy.
4. Create an access key for that user (choose CLI).
5. Configure the AWS CLI on your machine:
   ```bash
   aws configure
   aws sts get-caller-identity
   ```
   Use region `ap-south-1`. The keys are saved in `~/.aws/credentials` and are never added to git.

Run Terraform:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Check the AWS console under VPC (region ap-south-1). You should see `inventory-vpc` with 4 subnets.

Delete everything when done:

```bash
terraform destroy
```

### 10. EKS cluster (optional, costs money)

This costs around 5 to 6 USD per day. Only use it if you need it and delete it the same day.

In `terraform/terraform.tfvars` set:

```text
create_eks         = true
enable_nat_gateway = true
```

Then:

```bash
terraform apply
$(terraform output -raw configure_kubectl)
kubectl get nodes
cd ..
```

Install the add-ons and the app:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
helm install metrics-server metrics-server/metrics-server -n kube-system
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/prometheus-values.yaml

kubectl apply -f k8s/namespace.yaml
helm upgrade --install inventory ./helm/inventory -n inventory -f helm/inventory/values-eks.yaml \
  --set backend.image=ghcr.io/adityasingh-ops/inventory-backend --set backend.tag=$(git rev-parse HEAD) \
  --set frontend.image=ghcr.io/adityasingh-ops/inventory-frontend --set frontend.tag=$(git rev-parse HEAD)

kubectl get ingress -n inventory
```

The ADDRESS column shows the load balancer URL. Open it in the browser.

To delete it, uninstall ingress-nginx first. This removes the AWS load balancer, otherwise
`terraform destroy` can get stuck on the VPC.

```bash
helm uninstall ingress-nginx -n ingress-nginx
cd terraform
terraform destroy
```

---

## Notes

- Postgres runs inside Kubernetes with a persistent volume. In a real production setup you would use a managed database like Amazon RDS.
- The database password is stored in a Kubernetes Secret created from `values.yaml`. In production you would use something like AWS Secrets Manager.
- The services are named `backend`, `frontend` and `postgres` in both Docker Compose and Kubernetes, so the same Nginx config works in both.
