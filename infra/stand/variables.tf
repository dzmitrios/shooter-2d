variable "server_image" {
  type        = string
  description = "Game server image in ECR, including the tag."
}

variable "web_image" {
  type        = string
  description = "Web image in ECR, including the tag."
}
