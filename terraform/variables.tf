variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "cluster_name" {
  type    = string
  default = "inventory-eks"
}

variable "cluster_version" {
  type    = string
  default = "1.33"
}

variable "node_instance_type" {
  type    = string
  default = "t3.medium"
}

# NAT gateway (~$1/day) + EKS (~$2.4/day + nodes) are NOT free tier.
# For a free demo: create_eks = false and enable_nat_gateway = false -> only the VPC is created ($0).
variable "create_eks" {
  type    = bool
  default = true
}

variable "enable_nat_gateway" {
  type    = bool
  default = true
}
