import os
from dataclasses import dataclass


@dataclass
class Settings:
    auth_disabled: bool = os.environ.get("AUTH_DISABLED", "").lower() == "true"
    cognito_user_pool_id: str = os.environ.get("COGNITO_USER_POOL_ID", "")
    cognito_client_id: str = os.environ.get("COGNITO_CLIENT_ID", "")
    aws_region: str = os.environ.get("AWS_REGION", "us-east-1")


settings = Settings()
