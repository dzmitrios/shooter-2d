resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "database_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/shooter-stand/jwt-secret"
  type  = "SecureString"
  value = random_password.jwt_secret.result
}

resource "aws_ssm_parameter" "database_password" {
  name  = "/shooter-stand/database-password"
  type  = "SecureString"
  value = random_password.database_password.result
}
