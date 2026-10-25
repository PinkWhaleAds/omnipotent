# HTTPS entry of the API: the default CloudFront domain (xxxx.cloudfront.net), plus its custom hostname (alias,
# api.<domain>) once there is one. With a custom domain, a second distribution serves the tracking host (tracking_alias,
# s.<domain>): the tracking scripts only (below).
# CloudFront reaches the internal load balancer as a VPC origin: through a network interface it manages in
# the private subnets, so the traffic never leaves AWS's private network. That hop is HTTP (the load
# balancer has no certificate); CloudFront adds the secret origin header.
locals {
  tracking = var.tracking_alias != null

  # The route of the tracking scripts (GET /t/<key>.js, backend module tracking-script).
  tracking_path_pattern = "/t/*"

  # Viewer TLS with a custom hostname: TLS 1.2 and 1.3, strong ciphers only.
  minimum_protocol_version = "TLSv1.2_2021"
}

resource "aws_cloudfront_vpc_origin" "alb" {
  vpc_origin_endpoint_config {
    name                   = "${var.name}-api"
    arn                    = var.alb_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }

  timeouts {
    create = "30m"
    update = "30m"
    delete = "30m"
  }
}
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Every viewer header (Authorization, X-Organization-Id, Origin, Host...), cookie and query string goes to the
# backend, plus CloudFront-Viewer-Address ("<client ip>:<port>"): the address of the client as CloudFront saw
# it, which a client cannot forge through CloudFront. The backend logs and rate-limits by it
# (TRUST_CLOUDFRONT_VIEWER_ADDRESS); X-Forwarded-For starts with whatever the client sent.
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "${var.name}-api"
  comment = "All viewer headers, cookies and query strings, plus CloudFront-Viewer-Address"

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"

    headers {
      items = ["CloudFront-Viewer-Address"]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

# HSTS (1 year), X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy:
# strict-origin-when-cross-origin, X-XSS-Protection. No CSP: the API answers JSON, the tracking scripts are
# loaded cross-site, and the Swagger UI, when docs_enabled turns it on, brings its own inline code.
data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

# The paths of `cached_path_patterns` say themselves how long they may be kept, in their own
# `Cache-Control`. Nothing is cached without one (default TTL 0), which is every API answer.
resource "aws_cloudfront_cache_policy" "origin_cache_control" {
  name        = "${var.name}-origin-cache-control"
  comment     = "Follow the backend's Cache-Control; no cache without one"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = "${var.name} API"
  price_class     = var.price_class
  http_version    = "http2and3"
  is_ipv6_enabled = true
  web_acl_id      = var.web_acl_arn
  aliases         = var.alias == null ? [] : [var.alias]

  origin {
    origin_id           = "alb"
    domain_name         = var.alb_dns_name
    connection_attempts = 3
    connection_timeout  = 10

    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.alb.id
      origin_read_timeout      = var.origin_read_timeout
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }
  }

  # The API: never cached, every method.
  default_cache_behavior {
    target_origin_id           = "alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.cached_path_patterns

    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "alb"
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD", "OPTIONS"]
      cached_methods             = ["GET", "HEAD"]
      cache_policy_id            = aws_cloudfront_cache_policy.origin_cache_control.id
      origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
      compress                   = true
    }
  }

  # Standard logs (one line per request), to the access logs bucket.
  dynamic "logging_config" {
    for_each = var.logs_bucket_domain_name == null ? [] : [var.logs_bucket_domain_name]

    content {
      bucket          = logging_config.value
      prefix          = var.logs_prefix
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Without a custom hostname, the default *.cloudfront.net certificate (it still accepts TLS 1.0 and 1.1, which
  # cannot be changed); with one, its ACM certificate over SNI and at least TLS 1.2.
  viewer_certificate {
    cloudfront_default_certificate = var.alias == null
    acm_certificate_arn            = var.alias == null ? null : var.certificate_arn
    ssl_support_method             = var.alias == null ? null : "sni-only"
    minimum_protocol_version       = var.alias == null ? null : local.minimum_protocol_version
  }
}

# ---------------------------------------------------------------------------------------------------
# Tracking host (s.<domain>, with a custom domain only)
# ---------------------------------------------------------------------------------------------------
#
# The scripts the clients' sites load (`/t/<key>.js`) and nothing else, on a distribution of its own: the API's
# distribution stays as it is (no host-dependent code in the path of every API and MCP request), and the tracking host
# cannot expose the API by construction. Only its `/t/*` behaviour reaches the load balancer, through the same VPC
# origin and with the same secret header; any other path is answered 404 at the edge by a function, never forwarded.
# Same web ACL (the public rate limit covers /t/), same managed security headers and same caching as `/t/*` on the
# API's distribution, its own standard logs (cloudfront/tracking/). GET and HEAD only.

# Any request outside `/t/*`: 404 at the edge.
resource "aws_cloudfront_function" "tracking_not_found" {
  count = local.tracking ? 1 : 0

  name    = "${var.name}-tracking-not-found"
  runtime = "cloudfront-js-2.0"
  comment = "404 for anything but the tracking scripts"
  publish = true
  code    = <<-EOT
    function handler(event) {
      return { statusCode: 404, statusDescription: 'Not Found' };
    }
  EOT
}

# What reaches the backend from the visitors of the clients' sites, who load the script before any consent: their
# address (CloudFront-Viewer-Address, for the access log and the rate limits) and the path. No cookie, no query string,
# no other header (Referer, User-Agent...): the script depends on its key only.
resource "aws_cloudfront_origin_request_policy" "tracking" {
  count = local.tracking ? 1 : 0

  name    = "${var.name}-tracking"
  comment = "CloudFront-Viewer-Address only: no cookie, query string or other viewer header"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = ["CloudFront-Viewer-Address"]
    }
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_distribution" "tracking" {
  count = local.tracking ? 1 : 0

  enabled         = true
  comment         = "${var.name} tracking scripts"
  price_class     = var.price_class
  http_version    = "http2and3"
  is_ipv6_enabled = true
  web_acl_id      = var.web_acl_arn
  aliases         = [var.tracking_alias]

  origin {
    origin_id           = "alb"
    domain_name         = var.alb_dns_name
    connection_attempts = 3
    connection_timeout  = 10

    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.alb.id
      origin_read_timeout      = var.origin_read_timeout
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }
  }

  # Everything but the scripts: the function answers 404 before any cache or origin.
  default_cache_behavior {
    target_origin_id           = "alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.tracking_not_found[0].arn
    }
  }

  # The scripts, cached as the backend says (Cache-Control: public, max-age=300).
  ordered_cache_behavior {
    path_pattern               = local.tracking_path_pattern
    target_origin_id           = "alb"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.origin_cache_control.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.tracking[0].id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    compress                   = true
  }

  dynamic "logging_config" {
    for_each = var.logs_bucket_domain_name == null ? [] : [var.logs_bucket_domain_name]

    content {
      bucket          = logging_config.value
      prefix          = var.tracking_logs_prefix
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.tracking_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = local.minimum_protocol_version
  }
}
