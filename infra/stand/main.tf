module "network" {
  source = "./modules/network"
}

module "compute" {
  source = "./modules/compute"

  vpc_id    = module.network.vpc_id
  subnet_id = module.network.public_subnet_id

  server_image = var.server_image
  web_image    = var.web_image

  jwt_secret_parameter_name        = aws_ssm_parameter.jwt_secret.name
  database_password_parameter_name = aws_ssm_parameter.database_password.name
  jwt_secret_parameter_arn         = aws_ssm_parameter.jwt_secret.arn
  database_password_parameter_arn  = aws_ssm_parameter.database_password.arn
}
