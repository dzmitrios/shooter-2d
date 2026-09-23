data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*-kernel-*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "stand" {
  name        = "shooter-stand"
  description = "Public HTTP for the shooter stand"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "shooter-stand-instance"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/server",
      "arn:aws:ecr:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:repository/web",
    ]
  }

  statement {
    sid = "ReadStandSecrets"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [
      var.jwt_secret_parameter_arn,
      var.database_password_parameter_arn,
    ]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "shooter-stand-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "shooter-stand-instance"
  role = aws_iam_role.instance.name
}

resource "aws_instance" "stand" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t4g.small"
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.stand.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  associate_public_ip_address = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region                     = data.aws_region.current.name
    ecr_registry               = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com"
    server_image               = var.server_image
    web_image                  = var.web_image
    jwt_parameter_name         = var.jwt_secret_parameter_name
    db_password_parameter_name = var.database_password_parameter_name
  })

  user_data_replace_on_change = true

  depends_on = [
    aws_iam_role_policy.instance,
    aws_iam_role_policy_attachment.ssm,
  ]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = {
    Name = "shooter-stand"
  }
}
