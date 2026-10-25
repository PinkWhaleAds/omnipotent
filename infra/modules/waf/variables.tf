variable "name" {
  description = "Name of the web ACL and prefix of its metrics (e.g. omnipotent-prod)."
  type        = string
}

variable "rate_limit" {
  description = "Requests one client IP may send over the evaluation window, all routes and every distribution together, before getting 429s. 3000 per 5 minutes is 10 a second on average: far above a person using the app (an office behind one address included), far below a flood."
  type        = number
  default     = 3000

  validation {
    condition     = var.rate_limit >= 10 && var.rate_limit <= 2000000000
    error_message = "rate_limit is between 10 and 2,000,000,000 (AWS WAF limits)."
  }
}

variable "public_rate_limit" {
  description = "Requests one client IP may send to the anonymous routes (public_path_prefixes) over the evaluation window. Raise it in the phase that adds a public route a client's visitors or a platform call often."
  type        = number
  default     = 600

  validation {
    condition     = var.public_rate_limit >= 10 && var.public_rate_limit <= 2000000000
    error_message = "public_rate_limit is between 10 and 2,000,000,000 (AWS WAF limits)."
  }
}

variable "rate_limit_window" {
  description = "Evaluation window of the rate limits, in seconds (60, 120, 300 or 600). Also the Retry-After of the 429s."
  type        = number
  default     = 300

  validation {
    condition     = contains([60, 120, 300, 600], var.rate_limit_window)
    error_message = "rate_limit_window is 60, 120, 300 or 600."
  }
}

variable "public_path_prefixes" {
  description = "Path prefixes of the routes anyone can call without signing in (at least two): the probes, the status and the OAuth metadata of the MCP endpoint. Each phase adds the public routes it serves."
  type        = list(string)
  default     = ["/livez", "/readyz", "/healthz", "/status", "/.well-known/"]

  validation {
    condition     = length(var.public_path_prefixes) >= 2 && alltrue([for prefix in var.public_path_prefixes : startswith(prefix, "/")])
    error_message = "public_path_prefixes holds at least two paths starting with /."
  }
}

variable "common_rules_count_only" {
  description = "Rules of AWSManagedRulesCommonRuleSet only counted (metrics, sampled requests, logs), not blocked. SizeRestrictions_BODY refuses any body over 8 KB and SizeRestrictions_QUERYSTRING any query string over 2 KB, both of which legitimate API bodies and MCP calls exceed; CrossSiteScripting_BODY matches text a client may legitimately send (the API answers JSON, so nothing is interpreted as HTML)."
  type        = list(string)
  default     = ["SizeRestrictions_BODY", "SizeRestrictions_QUERYSTRING", "CrossSiteScripting_BODY"]
}

variable "logging_enabled" {
  description = "Log the blocked and counted requests to CloudWatch Logs (aws-waf-logs-<name>, us-east-1). Off by default: paid ingestion; metrics and sampled requests are on anyway."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Retention of the WAF logs, in days."
  type        = number
  default     = 30
}
