# Helpdesk — Secure Setup Guide

This guide walks through every step required to go live safely. Read it fully
before clicking anything in Azure or Exchange.

---

## Why a Separate App Registration?

The IT Inventory app already has an Azure app registration. Adding Mail.Read and
Mail.Send to that same registration would mean a single compromised credential
gives an attacker access to both inventory data AND the ability to read/send
email across your entire tenant.

Principle of least privilege: each service gets its own identity with only the
permissions it needs.

---

## What You Need Access To

- Azure Portal (Global Admin or Application Administrator role)
- Exchange Online PowerShell (Exchange Administrator role)
- SSH access to this server

---

## Step 1 — Create a New App Registration in Azure

1. Go to **portal.azure.com** → **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. Fill in:
   - **Name:** `Day Air IT Helpdesk`
   - **Supported account types:** Accounts in this organizational directory only (single tenant)
   - **Redirect URI:** Platform = **Web**, URI = `https://servicedesk.dayair.org/api/auth/callback`
4. Click **Register**
5. On the overview page, copy and save:
   - **Application (client) ID** → this is your `O365_CLIENT_ID`
   - **Directory (tenant) ID** → this is your `O365_TENANT_ID`

---

## Step 2 — Add API Permissions

1. In your new app registration, go to **API permissions** → **Add a permission**
2. Choose **Microsoft Graph** → **Application permissions**
3. Search for and select:
   - `Mail.Read` — allows the app to read the helpdesk inbox
   - `Mail.Send` — allows the app to send replies
4. Also add **Delegated permissions** → `User.Read`
   (this is needed for the O365 SSO login flow)
5. Click **Add permissions**
6. Click **Grant admin consent for Day Air Credit Union** and confirm

At this point the app CAN read and send mail for ANY mailbox in your tenant.
Step 5 locks it down to helpdesk@dayair.org only — do not skip Step 5.

---

## Step 3 — Create a Certificate Credential

Your tenant policy blocks client secrets, so you will use a certificate instead.
This is actually the more secure option — the private key never leaves your server.

### 3a — Generate the certificate on the server

```bash
openssl req -x509 -newkey rsa:2048 \
    -keyout /opt/helpdesk/helpdesk-graph.key \
    -out /opt/helpdesk/helpdesk-graph.crt \
    -days 730 -nodes \
    -subj "/CN=Day Air Helpdesk Graph/O=Day Air Credit Union"

chmod 600 /opt/helpdesk/helpdesk-graph.key
```

This creates:
- `helpdesk-graph.key` — the private key (stays on the server, never shared)
- `helpdesk-graph.crt` — the public certificate (uploaded to Azure)

### 3b — Upload the public certificate to Azure

1. In your new app registration, go to **Certificates & secrets** → **Certificates**
2. Click **Upload certificate**
3. Upload `/opt/helpdesk/helpdesk-graph.crt`
4. Click **Add**
5. **Copy the Thumbprint** shown in the certificate list — you will need it for your .env

### 3c — Mount the key into the container

The backend container needs to read the private key. Add a volume mount in
`/opt/helpdesk/docker-compose.yml` under the `helpdesk-backend` service:

```yaml
    volumes:
      - /opt/helpdesk/helpdesk-graph.key:/opt/helpdesk/helpdesk-graph.key:ro
```

> **If your tenant does allow client secrets** (and you prefer that simpler path):
> Create a client secret instead: Certificates & secrets → Client secrets → New client secret,
> set expiry 12 months, copy the Value into `O365_CLIENT_SECRET` in your .env.
> Leave the CERT variables blank.

---

## Step 4 — Configure the Helpdesk .env File

On the server, create the .env from the example:

```bash
cp /opt/helpdesk/.env.example /opt/helpdesk/.env
```

Open it and fill in:

| Variable | Value |
|---|---|
| `SECRET_KEY` | Run: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | Get `POSTGRES_PASSWORD` from `/opt/it-inventory/.env`, then: `postgresql+psycopg2://inventory:<password>@db:5432/inventory` |
| `O365_TENANT_ID` | From Step 1 |
| `O365_CLIENT_ID` | From Step 1 |
| `O365_CLIENT_CERT_PATH` | `/opt/helpdesk/helpdesk-graph.key` |
| `O365_CLIENT_CERT_THUMBPRINT` | Thumbprint from Step 3b |
| `O365_CLIENT_SECRET` | Leave blank (using certificate auth) |
| `O365_ADMIN_USERS` | Your UPN, e.g. `tbeaty@dayair.org` |

Leave all other values at their defaults for now.

---

## Step 5 — Restrict the App to the Helpdesk Mailbox Only (Critical)

This step locks the app down so it can only access `helpdesk@dayair.org`
even though the Graph API permission technically allows tenant-wide access.
Microsoft enforces this restriction at the API level.

### 5a — Install Exchange Online PowerShell (if not already installed)

Run this on any Windows machine with PowerShell (or PowerShell 7 on Mac/Linux):

```powershell
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser
```

### 5b — Connect to Exchange Online

```powershell
Connect-ExchangeOnline -UserPrincipalName tbeaty@dayair.org
```

Sign in with your admin account when prompted.

### 5c — Create a Mail-Enabled Security Group Containing Only the Helpdesk Mailbox

The ApplicationAccessPolicy works by specifying a group. The app can only
access mailboxes that are members of that group.

```powershell
New-DistributionGroup -Name "Helpdesk App Access Scope" -Alias "helpdesk-app-scope" -PrimarySmtpAddress "helpdesk-app-scope@dayair.org" -MemberJoinRestriction Closed -Type Security

Add-DistributionGroupMember -Identity "helpdesk-app-scope@dayair.org" -Member "helpdesk@dayair.org"
```

### 5d — Create the Application Access Policy

Replace `YOUR_CLIENT_ID` with the Application (client) ID from Step 1:

```powershell
New-ApplicationAccessPolicy -AppId "YOUR_CLIENT_ID" -PolicyScopeGroupId "helpdesk-app-scope@dayair.org" -AccessRight RestrictAccess -Description "Restrict helpdesk app to helpdesk@dayair.org mailbox only"
```

### 5e — Verify the Policy Works

Test that the app CAN access the helpdesk mailbox:

```powershell
Test-ApplicationAccessPolicy -AppId "YOUR_CLIENT_ID" -Identity "helpdesk@dayair.org"
```

Expected result: `AccessCheckResult: Granted`

Test that the app CANNOT access another mailbox:

```powershell
Test-ApplicationAccessPolicy -AppId "YOUR_CLIENT_ID" -Identity "tbeaty@dayair.org"
```

Expected result: `AccessCheckResult: Denied`

> **Note:** New policies can take up to 30 minutes to propagate in Exchange Online.
> If the test shows Granted for both right away, wait 30 minutes and test again.

---

## Step 6 — Start the Helpdesk

```bash
cd /opt/helpdesk
docker compose up -d
```

Check that both containers are running:

```bash
docker compose ps
docker logs helpdesk-backend --tail 30
```

You should see:
```
Tables ready.
Background email poller started.
Email poll loop started (interval=60s, mailbox=helpdesk@dayair.org)
```

---

## Step 7 — Verify End-to-End

1. Visit `https://servicedesk.dayair.org` — you should see the login page
2. Sign in with your Day Air Microsoft account
3. Send a test email to `helpdesk@dayair.org` from your personal email (not your Day Air account)
4. Wait up to 60 seconds
5. Refresh the helpdesk — the ticket should appear

If the ticket doesn't appear after 2 minutes:

```bash
docker logs helpdesk-backend --tail 50
```

Common issues:
- `Graph auth failed` → check your CLIENT_ID and CLIENT_SECRET in .env
- `502 Graph API error 403` → admin consent not granted, or policy not yet propagated
- `Denied` in the access policy test → wait 30 minutes for propagation

---

## Ongoing: Secret Rotation

Your client secret expires in 12 months. Set a calendar reminder for 11 months
from today. To rotate:

1. Azure Portal → App registration → Certificates & secrets → New client secret
2. Copy the new value
3. Update `O365_CLIENT_SECRET` in `/opt/helpdesk/.env`
4. `docker compose restart helpdesk-backend`
5. Verify the old secret is no longer shown/working, then delete it

---

## Optional Upgrade: Certificate Credential

A certificate is more secure than a client secret because the private key never
leaves the server. An attacker who reads your .env gets a thumbprint and
public certificate, not the actual signing key.

### Generate a self-signed certificate (valid 2 years)

```bash
openssl req -x509 -newkey rsa:2048 -keyout /opt/helpdesk/helpdesk-graph.key \
    -out /opt/helpdesk/helpdesk-graph.crt -days 730 -nodes \
    -subj "/CN=Day Air Helpdesk Graph/O=Day Air Credit Union"

chmod 600 /opt/helpdesk/helpdesk-graph.key
```

### Upload the public certificate to Azure

1. App registration → Certificates & secrets → Certificates → Upload certificate
2. Upload `/opt/helpdesk/helpdesk-graph.crt`
3. Copy the **Thumbprint** shown after upload

### Update .env

Replace `O365_CLIENT_SECRET` with:

```
O365_CLIENT_CERT_PATH=/run/secrets/helpdesk-graph.key
O365_CLIENT_CERT_THUMBPRINT=<thumbprint from Azure>
```

Mount the key into the container via docker-compose.yml (add to helpdesk-backend):

```yaml
volumes:
  - /opt/helpdesk/helpdesk-graph.key:/run/secrets/helpdesk-graph.key:ro
```

The backend graph.py client would need a small update to read the cert path from
settings and pass it to MSAL as:
```python
client_credential={"thumbprint": thumbprint, "private_key": open(cert_path).read()}
```

Ask Claude to make this change when you're ready to upgrade.

---

## Security Checklist

- [ ] Separate app registration created (not shared with IT Inventory)
- [ ] Only Mail.Read (Application) and Mail.Send (Application) added — nothing else
- [ ] Admin consent granted
- [ ] Exchange ApplicationAccessPolicy created and tested (Granted for helpdesk, Denied for others)
- [ ] Certificate private key is `chmod 600` and not committed to git
- [ ] .env file not readable by other users: `chmod 600 /opt/helpdesk/.env`
- [ ] Calendar reminder set to renew certificate in 23 months (cert is valid 2 years)
