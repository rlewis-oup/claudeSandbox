"""
Cognito JWT verification for tokens passed in from the upstream
ELT Editorial Utils portal.

Flow:
  1. The portal authenticates the user against Cognito and opens this app
     with the ID token in the URL hash fragment (#id_token=...).
  2. The frontend reads the token and sends it as `Authorization: Bearer
     <token>` on every API request.
  3. `verify_id_token()` validates the JWT against Cognito's JWKS (signature,
     issuer, audience, expiry) and returns the decoded claims. There is no
     server-side session — every request is verified independently.

Required environment variables:
    COGNITO_USER_POOL_ID  - e.g. us-east-1_xxxxxxxxx
    COGNITO_CLIENT_ID     - the portal's app client ID, used to verify the
                             'aud' claim (the token was issued to the portal,
                             not to this app)
    AWS_REGION            - e.g. us-east-1 (provided automatically by Lambda)
"""

import time
import threading
from typing import Optional

import jwt
import requests
from fastapi import HTTPException

from config import settings

# ---------------------------------------------------------------------------
# JWKS cache — fetched once, refreshed every 24 hours
# ---------------------------------------------------------------------------

_jwks_cache: Optional[dict] = None
_jwks_fetched_at: float = 0.0
_jwks_lock = threading.Lock()
_JWKS_TTL = 86400  # seconds


def _get_jwks() -> dict:
    """Return cached Cognito JWKS, refreshing if stale."""
    global _jwks_cache, _jwks_fetched_at

    with _jwks_lock:
        if _jwks_cache is None or (time.time() - _jwks_fetched_at) > _JWKS_TTL:
            url = (
                f"https://cognito-idp.{settings.aws_region}.amazonaws.com"
                f"/{settings.cognito_user_pool_id}/.well-known/jwks.json"
            )
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            _jwks_cache = response.json()
            _jwks_fetched_at = time.time()

    return _jwks_cache


def verify_id_token(token: str) -> dict:
    """
    Verify a Cognito ID token passed in from the portal.

    Validates signature, expiry, issuer, audience, and token_use.
    Returns decoded claims on success; raises HTTPException on failure.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.exceptions.DecodeError:
        raise HTTPException(status_code=401, detail="Invalid token format")

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing key ID")

    try:
        jwks = _get_jwks()
    except Exception:
        raise HTTPException(status_code=503, detail="Unable to fetch authentication keys")

    public_key = None
    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
            break

    if public_key is None:
        raise HTTPException(status_code=401, detail="Token signed by unknown key")

    issuer = f"https://cognito-idp.{settings.aws_region}.amazonaws.com/{settings.cognito_user_pool_id}"

    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=issuer,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Token audience is invalid")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Token issuer is invalid")
    except jwt.exceptions.DecodeError:
        raise HTTPException(status_code=401, detail="Token verification failed")

    if claims.get("token_use") != "id":
        raise HTTPException(status_code=401, detail="Only ID tokens are accepted")

    return claims
