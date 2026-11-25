# Lambda Web Adaptor template

FastAPI backend (Lambda + Lambda Web Adapter + API Gateway HTTP API) and a React frontend (S3 + CloudFront), deployed with SAM via GitHub Actions.

## Architecture

- **Backend**: FastAPI app packaged as a container image, run on AWS Lambda via the [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter), fronted by an API Gateway HTTP API.
- **Frontend**: React + Vite static site, built to `frontend/dist` and served from an S3 bucket behind CloudFront.
- **Routing**: one CloudFront distribution serves both — `/api/*` is routed to the API Gateway origin, everything else to the S3 origin.
- **Infra**: defined entirely in [`template.yaml`](./template.yaml) (AWS SAM/CloudFormation) — this is the source of truth for all AWS resources.
- **Deploy**: GitHub Actions builds the frontend, runs `sam build`/`sam deploy`, then syncs `frontend/dist` to S3 and invalidates CloudFront.

## Project structure

```
backend/               FastAPI app
  api/main.py           routes
  Dockerfile            Lambda container image (bundles the Lambda Web Adapter)
  pyproject.toml, uv.lock
frontend/               React + Vite app
  src/App.jsx            calls the backend at /api/*
  .env.example
template.yaml          SAM template: Lambda, HTTP API, S3, CloudFront
samconfig.toml         SAM CLI deploy config (stack name, region, etc.)
.github/workflows/     CI: deploy_by_sam.yaml
```

## Prerequisites

- [uv](https://docs.astral.sh/uv/) and Python 3.12 (backend)
- Node.js 20 (frontend)
- Docker (to build the Lambda container image)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and the AWS CLI, with credentials configured (only needed for manual/local deploys)

## Local development

**Backend** (http://localhost:8000):

```sh
cd backend
uv sync
uv run uvicorn api.main:app --reload --port 8000
```

**Frontend** (http://localhost:5173):

```sh
cd frontend
npm install
cp .env.example .env   # set VITE_API_URL=http://localhost:8000
npm run dev
```

Other frontend scripts: `npm run build`, `npm run preview`, `npm run lint`.

## Deploying manually

> [!WARNING]
> **Don't do this on an Apple Silicon (M-series) Mac.** The Lambda function builds as an `x86_64` container image (see `template.yaml`), and building/deploying that image locally on ARM runs into architecture-mismatch/emulation issues. Use the GitHub Actions deploy instead (below) — it runs on an x86_64 runner.

```sh
sam build
sam deploy

cd frontend && npm run build && cd ..
BUCKET=$(aws cloudformation describe-stacks --stack-name syllabus-architect-web-adaptor-stack \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text)
aws s3 sync frontend/dist "s3://$BUCKET" --delete

DIST_ID=$(aws cloudformation describe-stacks --stack-name syllabus-architect-web-adaptor-stack \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

## CI/CD deployment (GitHub Actions)

[`.github/workflows/deploy_by_sam.yaml`](./.github/workflows/deploy_by_sam.yaml) builds the frontend, runs `sam build`/`sam deploy`, then syncs `frontend/dist` to S3 and invalidates CloudFront. It authenticates to AWS via OIDC (no long-lived keys).

The workflow ships with its trigger branch set to `deployment-disabled`, so cloning this template won't cause an accidental deploy on push. **To enable auto-deploy**, edit the `on.push.branches` value in the workflow file to `main` (or whichever branch you want to deploy from).

### Staging / multiple environments

The same workflow deploys to different stacks depending on which branch triggered it — no need to duplicate the workflow file. A "Map branch to environment" step sets `SAM_CONFIG_ENV` based on `github.ref_name` (`main` → `dev`, `release` → `prod`), and a following step reads the matching `stack_name` straight out of `samconfig.toml` — **the stack name isn't hardcoded in the workflow**, so renaming a stack only means editing `samconfig.toml`.

`sam deploy --config-env "$SAM_CONFIG_ENV"` picks the matching section from `samconfig.toml` (`[dev.deploy.parameters]` / `[prod.deploy.parameters]`), so each branch/environment gets its own fully isolated stack (Lambda, API Gateway, S3 bucket, CloudFront distribution). To add another environment, add a case to the "Map branch to environment" step, a matching `[<env>.deploy.parameters]` block in `samconfig.toml`, and include the branch in `on.push.branches`.

### Required one-time setup outside this repo:
- (**Done already for the ELT AI Incubator AWS tenant**) An OIDC identity provider in the AWS account trusting `token.actions.githubusercontent.com`, and an IAM role trusting that provider (scoped to this repo) with permissions to deploy the stack.
- A repository variable `AWS_DEPLOY_ROLE_ARN` set to that role's ARN. The role should have both the trust policy and permissions.

Trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<REPO_NAME>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:GetRole",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "lambda:*",
        "apigateway:*",
        "logs:*",
        "cloudfront:*",
        "ecr:*",
        "ecr-public:GetAuthorizationToken",
        "sts:GetServiceBearerToken",
        "ssm:GetParameter"
      ],
      "Resource": "*"
    }
  ]
}
```

## Authentication with Cognito

This template ships with no auth. The common setup is to reuse an existing, shared **Cognito User Pool** (with an App Client and a Hosted UI domain already configured) rather than creating a new user pool per project. Wiring it in touches three places: the frontend (redirect to the Hosted UI), the infra (an API Gateway JWT authorizer), and the backend (reading the already-verified claims). No custom login UI is built anywhere — Cognito's Hosted UI is the login page.

**Prerequisite (usually already done, shared across projects):** a Cognito User Pool, an App Client for this app (public client, no secret, since it's a browser app) with the Hosted UI's OAuth flow enabled (Authorization code grant + PKCE), and the app's callback/sign-out URLs registered on that App Client (the CloudFront domain, plus `http://localhost:5173` for local dev).

**Timeline of a login + authenticated API call:**

**Note** The following may sound complicated, but Claude Code can do this easily once it has the cognito user pool ID and the app ID. If you are confused, just let Claude Code to do the investigation for you.

1. **Frontend redirects to the Hosted UI.** Instead of a login form, the frontend sends the browser to the User Pool's Hosted UI domain with the App Client ID. 
2. **User authenticates on Cognito's page**, not ours. Cognito handles login itself and redirects back to `redirect_uri` with a short-lived authorization `code` in the query string. You just need to make sure that your app's URL is on the allowed list of redirect uris, which you can configure in the AWS Concole Cognito page.
3. **Frontend exchanges the code for tokens** by calling the User Pool's token endpoint (still on the Hosted UI domain) with the code and the PKCE verifier. This returns an ID token, access token, and refresh token — all JWTs signed by the User Pool.
4. **Frontend calls the backend with the token attached.** Every request to `/api/*` includes `Authorization: Bearer <id token or access token>`. The frontend refreshes the token silently using the refresh token before it expires.
5. **API Gateway verifies the JWT before Lambda ever runs.** Add a JWT authorizer to the HTTP API in `template.yaml`, pointing at the User Pool's issuer (`https://cognito-idp.<region>.amazonaws.com/<user pool id>`) and the App Client ID as the allowed audience, and attach it to the routes that need auth (leave the `/` health check route open). API Gateway fetches the User Pool's public keys (JWKS) itself, checks the signature, expiry, issuer, and audience — an invalid or missing token is rejected with 401/403 before Lambda is invoked, so unauthenticated traffic never costs compute.
6. **Lambda/FastAPI receives claims, not a raw token to verify.** Because API Gateway already validated the JWT, FastAPI can trust and use the JWT to extract the user id directly — there's no JWT library or signature-checking needed in the backend, since trust boundary is API Gateway, not the app.

**Net effect:** the frontend never talks to the backend about identity directly — it only carries a token issued by Cognito. The backend never verifies a token — it only trusts claims that arrived via the request context, because only API Gateway (not the public internet) can populate that field.

## Customizing this template

- Add backend routes under `/api/*` in `backend/api/routes.py` — CloudFront only routes that path pattern to the API; anything outside it will hit the frontend origin instead.
- If forking this template for a new project, rename the stack(s) in `samconfig.toml` (`stack_name` under `[dev.deploy.parameters]` / `[prod.deploy.parameters]`) — that's the only place stack names are defined; the workflow reads them from there.
- **Deploy-time parameters (stack name, region, and other SAM CLI settings) belong in `samconfig.toml`, not hardcoded into `template.yaml` or the GitHub Actions workflow.** Coding agents (e.g. Claude Code) tend to hardcode these values elsewhere — avoid this, since it defeats the point of having a separate, environment-specific deploy config. Keep `template.yaml` parameterized and environment-agnostic.
- **To add authentication**, have Claude Code read [`Authentication.md`](./Authentication.md) and follow the steps. For local development without Cognito, set `AUTH_DISABLED=true` in `backend/.env` to bypass auth.
