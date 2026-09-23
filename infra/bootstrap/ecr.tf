resource "aws_ecr_repository" "server" {
  name                 = "server"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "web" {
  name                 = "web"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}
