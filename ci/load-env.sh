# shellcheck shell=bash
# load-env.sh — build one environment's settings for a run. SOURCE it, from the
# suite directory (.work/suite), so the exports reach Playwright:
#
#   cd .work/suite && source ../../ci/load-env.sh <environment>
#
# Where the settings come from:
#   - On GitHub: the chosen GitHub Environment's two secrets, each a whole file
#     pasted once: $ENV_CONFIG (its CONFIG_ENV, the config.env) and $ENV_SECRETS
#     (its SECRETS_ENV, the secrets.env). The workflow passes them in.
#   - On your laptop (ci/run-local.sh): environments/<env>/config.env and your
#     git-ignored environments/<env>/secrets.env, as before.
#
# Order, later winning:
#   1. UPSTREAM_ENV named in the config: a profile the suite ships
#      (deploy/<name>.env), relative to the suite directory
#   2. the config itself (public values): $ENV_CONFIG, else
#      environments/<env>/config.env
#   3. environments/<env>/expectations.json, if present → EXPECTATIONS_FILE
#   4. run inputs: INPUT_BASE_URL, INPUT_TENANT_SLUG, INPUT_DIGIT_TENANT
#   5. secrets, KEY=value lines: $ENV_SECRETS, else environments/<env>/secrets.env
#
# Pasted text ($ENV_CONFIG, $ENV_SECRETS) is read line by line and never
# executed, so any character is safe in a value. In GitHub Actions each secret
# value is masked (shown as ***) in the logs; config values are not, so the
# address and tenant stay readable. $ENV_SECRETS_NAME / $ENV_CONFIG_NAME name
# the secrets in messages.
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
# quotes is dropped (so "  padded  " keeps its spaces). $3 = secret (mask the
# values in GitHub Actions and list the keys in SECRET_KEYS) or config.
_le_load_lines() {
  local text="$1" origin="$2" kind="${3:-secret}" line key val n=0
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
    if [[ "$kind" == "secret" && -n "${GITHUB_ACTIONS:-}" && -n "$val" ]]; then
      echo "::add-mask::$val"
    fi
    export "$key=$val"
    [[ "$kind" == "secret" ]] && SECRET_KEYS="${SECRET_KEYS}${key} "
  done <<< "$text"
  return 0
}
_le_load_secrets() { _le_load_lines "$1" "$2" secret; }

_le_main() {
  local env_name="$1"
  local root="${CI_ROOT:?CI_ROOT must point at the repo root}"
  local dir="$root/environments/$env_name"

  # The config: the pasted CONFIG_ENV on GitHub, else the file in this repo.
  local config_text="" config_where=""
  if [[ -n "${ENV_CONFIG:-}" ]]; then
    # A GitHub Environment name: no slashes or dots that could reach another folder.
    if [[ ! "$env_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
      _le_problem "environment name '$env_name' must be letters, digits, - or _"
      return 1
    fi
    config_text="$ENV_CONFIG"
    config_where="${ENV_CONFIG_NAME:-the CONFIG_ENV secret of the $env_name environment}"
  else
    if [[ ! "$env_name" =~ ^[a-z0-9_]+$ ]]; then
      _le_problem "environment name '$env_name' must be lowercase letters, digits or _ (it becomes the secret name SECRETS_<NAME>)"
      return 1
    fi
    if [[ ! -f "$dir/config.env" ]]; then
      if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
        _le_problem "CONFIG_ENV is missing in the $env_name environment's secrets"
      else
        _le_problem "environments/$env_name/config.env doesn't exist on this branch"
      fi
      return 1
    fi
    config_where="environments/$env_name/config.env"
  fi

  # 1. the suite's own profile for this deployment
  local upstream
  if [[ -n "$config_text" ]]; then
    upstream="$(printf '%s\n' "$config_text" | sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?UPSTREAM_ENV=["'\'']?([^"'\''#[:space:]]*).*/\2/p' | tail -1)"
  else
    upstream="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?UPSTREAM_ENV=["'\'']?([^"'\''#[:space:]]*).*/\2/p' "$dir/config.env" | tail -1)"
  fi
  if [[ -n "$upstream" ]]; then
    if [[ "$upstream" != /* && "$upstream" != *..* && -f "$upstream" ]]; then
      set -a
      # shellcheck disable=SC1090
      source "$upstream"
      set +a
    else
      _le_problem "$config_where names UPSTREAM_ENV=$upstream, but this suite has no such file"
    fi
  fi

  # 2. this deployment's config: pasted text is read line by line, never run;
  #    the file in this repo is sourced, as before
  if [[ -n "$config_text" ]]; then
    _le_load_lines "$config_text" "$config_where" config
  else
    set -a
    # shellcheck disable=SC1091
    source "$dir/config.env"
    set +a
  fi

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
    _le_load_secrets "$ENV_SECRETS" "${ENV_SECRETS_NAME:-the SECRETS_$(echo "$env_name" | tr '[:lower:]' '[:upper:]') secret}"
  elif [[ -n "${GITHUB_ACTIONS:-}" && -n "$config_text" ]]; then
    _le_problem "SECRETS_ENV is missing in the $env_name environment's secrets"
  elif [[ -f "$dir/secrets.env" ]]; then
    _le_load_secrets "$(cat "$dir/secrets.env")" "environments/$env_name/secrets.env"
  fi

  # Checks: say plainly what is missing instead of letting a setup step fail
  # 10 minutes later with a stack trace.
  if [[ -z "${BASE_URL:-}" ]]; then
    _le_problem "BASE_URL is not set: set it in $config_where"
  elif [[ ! "$BASE_URL" =~ ^https?:// ]]; then
    _le_problem "BASE_URL must start with http:// or https:// (got: $BASE_URL)"
  fi
  if [[ -z "${DIGIT_TENANT:-}" ]]; then
    _le_problem "DIGIT_TENANT is not set: set it in $config_where"
  fi
  # The Keycloak/Identity BFF sign-in can't work without the workspace slug.
  if grep -q 'IDENTITY_TEST_TENANT_SLUG' tests/utils/identity-bff.ts 2>/dev/null; then
    if [[ -z "${IDENTITY_TEST_TENANT_SLUG:-}" ]]; then
      _le_problem "IDENTITY_TEST_TENANT_SLUG (the workspace slug) is not set: set it in $config_where"
    elif [[ ! "$IDENTITY_TEST_TENANT_SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      _le_problem "IDENTITY_TEST_TENANT_SLUG must be lowercase letters, digits and - (got: $IDENTITY_TEST_TENANT_SLUG)"
    fi
  fi
  if [[ -n "${EXPECTATIONS_FILE:-}" && ! -f "$EXPECTATIONS_FILE" ]]; then
    _le_problem "EXPECTATIONS_FILE=$EXPECTATIONS_FILE doesn't exist in this suite"
  fi

  echo "[load-env] environment:   $env_name"
  echo "[load-env] config from:   $config_where"
  echo "[load-env] BASE_URL:      ${BASE_URL:-(unset)}"
  echo "[load-env] tenant:        ${DIGIT_TENANT:-(unset)}  workspace slug: ${IDENTITY_TEST_TENANT_SLUG:-(unset)}"
  echo "[load-env] expectations:  ${EXPECTATIONS_FILE:-deploy/expectations/default.json (suite default)}"
  echo "[load-env] secrets set:   ${SECRET_KEYS:-(none)}"
  [[ -z "$CONFIG_PROBLEMS" ]]
}

_le_main "$@"
