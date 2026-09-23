output "state_bucket_name" {
  value = aws_s3_bucket.state.bucket
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "server_repository_url" {
  value = aws_ecr_repository.server.repository_url
}

output "web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}
