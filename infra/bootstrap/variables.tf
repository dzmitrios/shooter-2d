variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to assume the deploy role, as org/name."
  default     = "dzmitrios/shooter-2d"
}
