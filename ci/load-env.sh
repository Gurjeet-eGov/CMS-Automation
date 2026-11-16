# shellcheck shell=bash
# load-env.sh — build one environment's settings for a run. SOURCE it, from the
# suite directory (.work/suite), so the exports reach Playwright:
#
#   cd .work/suite && source ../../ci/load-env.sh <environment>
#
# Order, later winning:
#   1. UPSTREAM_ENV named in environments/<env>/config.env: a profile the suite
#      ships (deploy/<name>.env), relative to the suite directory
#   2. environments/<env>/config.env itself (public values)
#   3. environments/<env>/expectations.json, if present → EXPECTATIONS_FILE
#   4. run inputs: INPUT_BASE_URL, INPUT_TENANT_SLUG, INPUT_DIGIT_TENANT
#   5. secrets, KEY=value lines: $ENV_SECRETS (CI: the SECRETS_<ENV> repository
#      secret), else environments/<env>/secrets.env (local runs)
#
# Secrets are read line by line and never executed, so any character is safe in
# a value. In GitHub Actions each value is masked (shown as ***) in the logs.
#
# Afterwards:
#   CONFIG_PROBLEMS  newline-separated reasons the run can't start (empty = ok)
#   SECRET_KEYS      names of the secret keys that were set (never the values)
# Returns 1 when CONFIG_PROBLEMS is not empty.
#
# Needs CI_ROOT (the repo root) in the environment; ci/run-suite.sh sets it.

CONFIG_PROBLEMS=""
SECRET_KEYS=""

_le_problem() { CONFIG_PROBLEMS="${CONFIG_PROBLEMS}$1"$'\n'; }

# Parse KEY=value lines from $1 and export them. Values are literal, except
# that spaces around them are trimmed and one pair of matching surrounding
# quotes is dropped (so "  padded  " keeps its spaces).
_le_load_secrets() {
  local text="$1" origin="$2" line key val n=0
  local re='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ ! "$line" =~ $re ]]; then
      _le_problem "line $n of $origin is not KEY=value (its content isn't shown, in case it is a secret)"
      continue
    fi
    key="${BASH_REMATCH[2]}"
    val="${BASH_REMATCH[3]}"
    # Spaces around the value are pasting noise; quote the value to keep them.
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if (( ${#val} >= 2 )) && { [[ "$val" == \"*\" ]] || [[ "$val" == \'*\' ]]; }; then
      val="${val:1:${#val}-2}"
    fi
    if [[ -n "${GITHUB_ACTIONS:-}" && -n "$val" ]]; then
      echo "::add-mask::$val"
    fi
    export "$key=$val"
    SECRET_KEYS="${SECRET_KEYS}${key} "
  done <<< "$text"
}

_le_main() {
  local env_name="$1"
  local root="${CI_ROOT:?CI_ROOT must point at the repo root}"
  local dir="$root/environments/$env_name"

  if [[ ! "$env_name" =~ ^[a-z0-9_]+$ ]]; then
    _le_problem "environment name '$env_name' must be lowercase letters, digits or _ (it becomes the secret name SECRETS_<NAME>)"
    return 1
  fi
  if [[ ! -f "$dir/config.env" ]]; then
    _le_problem "environments/$env_name/config.env doesn't exist on this branch"
    return 1
  fi

  # 1. the suite's own profile for this deployment
  local upstream
  upstream="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?UPSTREAM_ENV=["'\'']?([^"'\''#[:space:]]*).*/\2/p' "$dir/config.env" | tail -1)"
  if [[ -n "$upstream" ]]; then
    if [[ -f "$upstream" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$upstream"
      set +a
    else
      _le_problem "environments/$env_name/config.env names UPSTREAM_ENV=$upstream, but this suite has no such file"
    fi
  fi

  # 2. this repo's config for the environment
  set -a
  # shellcheck disable=SC1091
  source "$dir/config.env"
  set +a

  # 3. an expectations file kept with the environment
  if [[ -f "$dir/expectations.json" ]]; then
    mkdir -p deploy/expectations
    cp "$dir/expectations.json" "deploy/expectations/ci-$env_name.json"
    export EXPECTATIONS_FILE="deploy/expectations/ci-$env_name.json"
  fi

  # 4. run inputs
  if [[ -n "${INPUT_BASE_URL:-}" ]]; then export BASE_URL="${INPUT_BASE_URL%/}"; fi
  if [[ -n "${INPUT_TENANT_SLUG:-}" ]]; then export IDENTITY_TEST_TENANT_SLUG="$INPUT_TENANT_SLUG"; fi
  if [[ -n "${INPUT_DIGIT_TENANT:-}" ]]; then
    export DIGIT_TENANT="$INPUT_DIGIT_TENANT"
    # A run input names a different tenant: drop a configured root/city that
    # belonged to the old one (the suite derives them from DIGIT_TENANT).
    unset ROOT_TENANT CITY_TENANT TENANT_CODE
  fi

  # 5. secrets
  if [[ -n "${ENV_SECRETS:-}" ]]; then
    _le_load_secrets "$ENV_SECRETS" "the SECRETS_$(echo "$env_name" | tr '[:lower:]' '[:upper:]') secret"
  elif [[ -f "$dir/secrets.env" ]]; then
    _le_load_secrets "$(cat "$dir/secrets.env")" "environments/$env_name/secrets.env"
  fi

  # Checks: say plainly what is missing instead of letting a setup step fail
  # 10 minutes later with a stack trace.
  if [[ -z "${BASE_URL:-}" ]]; then
    _le_problem "BASE_URL is not set: give the base_url input, or set it in environments/$env_name/config.env"
  elif [[ ! "$BASE_URL" =~ ^https?:// ]]; then
    _le_problem "BASE_URL must start with http:// or https:// (got: $BASE_URL)"
  fi
  if [[ -z "${DIGIT_TENANT:-}" ]]; then
    _le_problem "DIGIT_TENANT is not set: give the digit_tenant input, or set it in environments/$env_name/config.env"
  fi
  # The Keycloak/Identity BFF sign-in can't work without the workspace slug.
  if grep -q 'IDENTITY_TEST_TENANT_SLUG' tests/utils/identity-bff.ts 2>/dev/null; then
    if [[ -z "${IDENTITY_TEST_TENANT_SLUG:-}" ]]; then
      _le_problem "IDENTITY_TEST_TENANT_SLUG (the workspace slug) is not set: give the tenant_slug input, or set it in environments/$env_name/config.env"
    elif [[ ! "$IDENTITY_TEST_TENANT_SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      _le_problem "IDENTITY_TEST_TENANT_SLUG must be lowercase letters, digits and - (got: $IDENTITY_TEST_TENANT_SLUG)"
    fi
  fi
  if [[ -n "${EXPECTATIONS_FILE:-}" && ! -f "$EXPECTATIONS_FILE" ]]; then
    _le_problem "EXPECTATIONS_FILE=$EXPECTATIONS_FILE doesn't exist in this suite"
  fi

  echo "[load-env] environment:   $env_name"
  echo "[load-env] BASE_URL:      ${BASE_URL:-(unset)}"
  echo "[load-env] tenant:        ${DIGIT_TENANT:-(unset)}  workspace slug: ${IDENTITY_TEST_TENANT_SLUG:-(unset)}"
  echo "[load-env] expectations:  ${EXPECTATIONS_FILE:-deploy/expectations/default.json (suite default)}"
  echo "[load-env] secrets set:   ${SECRET_KEYS:-(none)}"
  [[ -z "$CONFIG_PROBLEMS" ]]
}

_le_main "$@"
