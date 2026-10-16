# Network: VPC with 2 public + 2 private subnets across 2 availability zones
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"

  name = "inventory-vpc"
  cidr = "10.20.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  public_subnets  = ["10.20.101.0/24", "10.20.102.0/24"]
  private_subnets = ["10.20.1.0/24", "10.20.2.0/24"]

  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = true # one NAT = cheaper

  # tags so Kubernetes can place load balancers in the right subnets
  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}

# Kubernetes: EKS cluster + one managed node group
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.37.1"

  create = var.create_eks

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = true
  enable_cluster_creator_admin_permissions = true

  cluster_addons = {
    coredns            = {}
    kube-proxy         = {}
    vpc-cni            = {}
    aws-ebs-csi-driver = {} # needed for the Postgres PersistentVolume
  }

  eks_managed_node_groups = {
    main = {
      instance_types = [var.node_instance_type]
      min_size       = 2
      max_size       = 3
      desired_size   = 2

      iam_role_additional_policies = {
        ebs = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
      }
    }
  }
}
