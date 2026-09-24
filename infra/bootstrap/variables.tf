variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to assume the deploy role, as org/name."
  default     = "dzmitrios/shooter-2d"
}

variable "github_owner_id" {
  type        = string
  description = "GitHub owner id. Repositories created after 2026-07-15 include it in the OIDC sub claim."
  default     = "304522246"
}

variable "github_repository_id" {
  type        = string
  description = "GitHub repository id. Repositories created after 2026-07-15 include it in the OIDC sub claim."
  default     = "1378472789"
}
