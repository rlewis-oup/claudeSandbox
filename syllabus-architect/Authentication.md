# Authentication Setup

Add Cognito-based authentication to a project built from this template. Uses the Cognito Hosted UI (implicit flow) — no custom login page needed.

**Prerequisite:** An existing Cognito User Pool with a Hosted UI domain configured. You need the User Pool ID and the domain prefix.

## What's already in the template

- `backend/config.py` — `Settings` with `AUTH_DISABLED` toggle
- `backend/api/deps.py` — `get_user_id` dependency that extracts the `sub` claim from the JWT (raises 401 if token is missing/invalid when auth is enabled)

To protect a route, add `Depends(get_user_id)`:

```python
from typing import Annotated
from fastapi import Depends
from api.deps import get_user_id

@router.get("/example")
def example(user_id: Annotated[str, Depends(get_user_id)]):
    ...
```

For local development without Cognito, set `AUTH_DISABLED=true` in `backend/.env`.

---

## Steps to enable auth

### 1. Add parameters to `template.yaml`

Add before `Resources`:

```yaml
Parameters:
  UserPoolId:
    Type: String
    Description: Cognito User Pool ID
  CognitoDomain:
    Type: String
    Description: Cognito User Pool domain prefix
```

### 2. Add a UserPoolClient resource to `template.yaml`

Under `Resources`:

```yaml
  FrontendClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: !Sub "${AWS::StackName}-frontend"
      UserPoolId: !Ref UserPoolId
      ExplicitAuthFlows:
        - ALLOW_USER_SRP_AUTH
        - ALLOW_REFRESH_TOKEN_AUTH
      AllowedOAuthFlows:
        - implicit
      AllowedOAuthFlowsUserPoolClient: true
      AllowedOAuthScopes:
        - openid
        - email
        - profile
      CallbackURLs:
        - http://localhost:5173
      LogoutURLs:
        - http://localhost:5173
      SupportedIdentityProviders:
        - COGNITO
```

### 3. Add an explicit HttpApi with a JWT authorizer

The template currently uses an implicit `ServerlessHttpApi` (auto-created by SAM from the function's `Events`). Replace it with an explicit `AWS::Serverless::HttpApi`. Once `ApiFunction.Events` references `ApiId: !Ref ApiGateway`, SAM stops creating the implicit API — no resource needs to be deleted.

```yaml
  ApiGateway:
    Type: AWS::Serverless::HttpApi
    Properties:
      Auth:
        Authorizers:
          CognitoAuthorizer:
            JwtConfiguration:
              issuer: !Sub "https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPoolId}"
              audience:
                - !Ref FrontendClient
            IdentitySource: "$request.header.Authorization"
        DefaultAuthorizer: CognitoAuthorizer
      CorsConfiguration:
        AllowMethods:
          - "*"
        AllowHeaders:
          - "*"
        AllowOrigins:
          - "*"
```

Update `ApiFunction.Events` to reference it:

```yaml
      Events:
        Proxy:
          Type: HttpApi
          Properties:
            ApiId: !Ref ApiGateway
            Path: /{proxy+}
            Method: ANY
```

Update the CloudFront `ApiOrigin` to use `${ApiGateway}` instead of `${ServerlessHttpApi}`:

```yaml
            DomainName: !Sub "${ApiGateway}.execute-api.${AWS::Region}.${AWS::URLSuffix}"
```

Update the `ApiUrl` output the same way:

```yaml
  ApiUrl:
    Value: !Sub "https://${ApiGateway}.execute-api.${AWS::Region}.amazonaws.com"
```

### 4. Add Cognito outputs to `template.yaml`

```yaml
  CognitoUserPoolId:
    Description: Cognito User Pool ID
    Value: !Ref UserPoolId

  CognitoClientId:
    Description: Cognito User Pool Client ID
    Value: !Ref FrontendClient

  CognitoDomain:
    Description: Cognito domain prefix
    Value: !Ref CognitoDomain
```

### 5. Add parameter overrides to `samconfig.toml`

Add `parameter_overrides` to each `[*.deploy.parameters]` section:

```toml
parameter_overrides = [
    "UserPoolId=us-east-1_XXXXXXXXX",
    "CognitoDomain=your-domain-prefix",
]
```

### 6. Create `frontend/src/auth.js`

```javascript
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID
const REDIRECT_URI = window.location.origin
const TOKEN_KEY = 'id_token'

export const HAS_AUTH = Boolean(COGNITO_DOMAIN && CLIENT_ID)

function parseJwtPayload(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(base64))
}

export function handleCallback() {
  const hash = window.location.hash.substring(1)
  const params = new URLSearchParams(hash)
  const token = params.get('id_token')
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token)
    window.history.replaceState(null, '', window.location.pathname)
    return true
  }
  return false
}

export function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) return null
  try {
    const payload = parseJwtPayload(token)
    if (payload.exp * 1000 < Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY)
      return null
    }
    return token
  } catch {
    sessionStorage.removeItem(TOKEN_KEY)
    return null
  }
}

export function isAuthenticated() {
  return getToken() !== null
}

export function login() {
  const url = `https://${COGNITO_DOMAIN}.auth.${import.meta.env.VITE_COGNITO_REGION || 'us-east-1'}.amazoncognito.com/oauth2/authorize`
    + `?client_id=${CLIENT_ID}`
    + `&response_type=token`
    + `&scope=openid+email+profile`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
  window.location.href = url
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY)
  const url = `https://${COGNITO_DOMAIN}.auth.${import.meta.env.VITE_COGNITO_REGION || 'us-east-1'}.amazoncognito.com/logout`
    + `?client_id=${CLIENT_ID}`
    + `&logout_uri=${encodeURIComponent(REDIRECT_URI)}`
  window.location.href = url
}
```

### 7. Wire auth into `frontend/src/App.jsx`

Import and use:

```javascript
import { HAS_AUTH, handleCallback, isAuthenticated, getToken, login, logout } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || (HAS_AUTH ? '' : 'http://localhost:8000');
const API = `${API_BASE}/api`;

const fetchApi = async (url, options = {}) => {
  const headers = { ...options.headers };
  if (HAS_AUTH) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return fetch(url, { ...options, headers });
};
```

On mount, handle the OAuth callback and redirect if unauthenticated:

```javascript
const [authReady, setAuthReady] = useState(!HAS_AUTH);

useEffect(() => {
  if (!HAS_AUTH) return;
  handleCallback();
  if (!isAuthenticated()) {
    login();
    return;
  }
  setAuthReady(true);
}, []);
```

When `HAS_AUTH` is false (local dev without Cognito env vars), auth is skipped entirely — `authReady` starts as `true` and API calls go to `http://localhost:8000` without a token.

### 8. Update GitHub Actions workflow

The frontend build must happen **after** `sam deploy` because the Cognito Client ID is a stack output. After deploying and syncing the frontend, update the Cognito client callback URLs to include the CloudFront domain.

In `.github/workflows/deploy_by_sam.yaml`, move the "Build frontend" step to after deploy and add the callback URL update:

```yaml
      - name: sam deploy
        run: sam deploy --config-env "$SAM_CONFIG_ENV"

      - name: Build frontend with Cognito config
        working-directory: frontend
        run: |
          CLIENT_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
            --query "Stacks[0].Outputs[?OutputKey=='CognitoClientId'].OutputValue" --output text)
          COGNITO_DOMAIN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
            --query "Stacks[0].Outputs[?OutputKey=='CognitoDomain'].OutputValue" --output text)
          cat <<EOF > .env.production
          VITE_COGNITO_CLIENT_ID=$CLIENT_ID
          VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
          VITE_COGNITO_REGION=${{ env.AWS_REGION }}
          EOF
          npm ci
          npm run build

      # The existing "Sync frontend to S3 and invalidate CloudFront" step
      # remains unchanged — it just runs after this new build step.

      - name: Update Cognito callback URLs
        run: |
          USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
            --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" --output text)
          CLIENT_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
            --query "Stacks[0].Outputs[?OutputKey=='CognitoClientId'].OutputValue" --output text)
          FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
            --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionDomain'].OutputValue" --output text)
          aws cognito-idp update-user-pool-client \
            --user-pool-id "$USER_POOL_ID" \
            --client-id "$CLIENT_ID" \
            --allowed-o-auth-flows implicit \
            --allowed-o-auth-flows-user-pool-client \
            --allowed-o-auth-scopes openid email profile \
            --supported-identity-providers COGNITO \
            --callback-urls "http://localhost:5173" "https://$FRONTEND_URL" \
            --logout-urls "http://localhost:5173" "https://$FRONTEND_URL" \
            --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
            > /dev/null
```

> **Note:** The deploy role needs `cognito-idp:UpdateUserPoolClient` permission for this step. Add it to the CICD IAM role's policy.
