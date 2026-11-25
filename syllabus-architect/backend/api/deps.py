from fastapi import HTTPException, Request

from auth import verify_id_token
from config import settings


def get_user_id(request: Request) -> str:
    if settings.auth_disabled:
        return "anonymous"

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = auth_header[7:]
    claims = verify_id_token(token)

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Missing sub claim")
    return sub
