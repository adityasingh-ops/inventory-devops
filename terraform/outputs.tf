output "cluster_name" {
  value = var.create_eks ? module.eks.cluster_name : "EKS not created"
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "configure_kubectl" {
  value = "aws eks update-kubeconfig --name ${var.cluster_name} --region ${var.aws_region}"
}
