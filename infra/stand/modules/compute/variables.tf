variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "server_image" {
  type = string
}

variable "web_image" {
  type = string
}

variable "jwt_secret_parameter_name" {
  type = string
}

variable "database_password_parameter_name" {
  type = string
}

variable "jwt_secret_parameter_arn" {
  type = string
}

variable "database_password_parameter_arn" {
  type = string
}
