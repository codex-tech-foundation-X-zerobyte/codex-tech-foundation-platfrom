# GitHub (and Vercel) setup guide

Follow this top to bottom, once. Every step ends with **how you will know it worked**, and from step 7 on the Workspace checks itself for you: **Admin, Integrations, GitHub, Connection check** reads GitHub, Supabase and Vercel's real answers and tells you what is left. The same steps are in the app as a checklist (**Setup guide**, at the top of the GitHub card) that ticks itself off from that check.

GitHub, Supabase and Vercel rename menus now and then. The names below are from memory and were not checked against the live sites. If one does not match, look for the closest name, and tell me what you see.

> **Never paste the private key, the webhook secret or any token into a chat, an email, a ticket or the code repository.** They go only into Supabase's function secrets (and, for the webhook secret, into GitHub's webhook box).

---

## 0. Before you start

- [ ] You are an **owner** of the GitHub organisation that owns the repositories (or the repositories are on your own account).
- [ ] The **Supabase CLI** is installed, you ran `supabase login`, and the project folder is linked to your project (`supabase link --project-ref <your-project-ref>`). Your project ref is the part of your Supabase URL before `.supabase.co`.
- [ ] You can open the Workspace as the **Main Admin**.
- [ ] Optional: a **Vercel** account, if you want the Deployments tab.
- [ ] Everything built before this feature is already deployed and its database files are already run.

---

## 1. Run the three database files

In Supabase, open **SQL Editor**. Paste each file's contents from `supabase/migrations/` and run it, **in this order**. Running one twice is safe.

1. `20261006000000_github_app_and_activity.sql`
2. `20261007000000_github_write_access.sql`
3. `20261008000000_deployment_targets.sql`

**How you will know:** the connection check later shows **Database migrations: OK**. If it says some are missing, it names the exact file.

---

## 2. Deploy the three functions

In a terminal in the project folder:

```powershell
supabase functions deploy integrations
supabase functions deploy github-webhook --no-verify-jwt
supabase functions deploy workspace-sweep --no-verify-jwt
```

- `integrations` is the normal one (people must be logged in).
- `github-webhook` **must** have `--no-verify-jwt`. GitHub cannot send a Supabase login token; the webhook's own signature check is what protects it. Forgetting this flag is the most common mistake: GitHub's deliveries then fail with 401.
- `workspace-sweep` also has the flag; it protects itself with its own secret (step 10).

**How you will know:** the three commands finish without errors. Step 9 proves the webhook is live.

---

## 3. Make a webhook secret

This is a shared password between GitHub and your server. You make it once and give the **same value to both**.

Easiest: in the Workspace, open the **Setup guide**, step **Make a webhook secret**, and press **Make a secret**. It is created in your browser and is not saved or sent anywhere. Copy it somewhere safe for the next two steps.

Or in PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

Rules: at least 16 characters (the receiver refuses anything shorter); do not reuse another secret; keep it out of anything you share.

---

## 4. Create the GitHub App

GitHub: **Settings, Developer settings, GitHub Apps, New GitHub App**. If the repositories belong to an organisation, start from the **organisation's** settings so the organisation owns the App.

| Field | Value |
|---|---|
| Name | Anything, for example `Codex Workspace` |
| Homepage URL | Your Workspace address |
| Webhook: Active | **Ticked** |
| Webhook URL | `https://<your-project-ref>.supabase.co/functions/v1/github-webhook` |
| Webhook secret | The secret from step 3 |
| User authorization options | Leave as they are. The Workspace does not use them. |
| Where can this App be installed | **Only on this account** |

**Repository permissions** (all **Read-only** to begin with):

| Permission | Level |
|---|---|
| Metadata | Read-only (GitHub sets this for you) |
| Contents | Read-only |
| Issues | Read-only |
| Pull requests | Read-only |
| Actions | Read-only |
| Deployments | Read-only |
| **Checks** | Read-only (easy to forget; without it CI status shows "unavailable") |

**Subscribe to events** (this list appears after the permissions are saved): **Push, Pull request, Pull request review, Issues, Workflow run, Deployment status.**

Then **Create GitHub App**. On the App's page:

1. Note the **App ID** (a number near the top).
2. Under **Private keys**, press **Generate a private key**. GitHub downloads a `.pem` file **once**. Keep it somewhere safe.

**How you will know:** after step 5, the connection check shows the App signing in, with **App permissions (read): OK** and **App webhook events: OK**.

---

## 5. Give the three secrets to Supabase

In Supabase: **Edge Functions, Secrets**. Add each by its **exact** name:

| Name | Value |
|---|---|
| `GITHUB_APP_ID` | The App ID number |
| `GITHUB_APP_PRIVATE_KEY` | The **entire** text of the `.pem` file, including the `-----BEGIN ...-----` and `-----END ...-----` lines |
| `GITHUB_WEBHOOK_SECRET` | The same secret you gave GitHub in step 4 |

The dashboard accepts the multi-line key pasted as it is. From the command line (I could not test this one here, so use the dashboard if it gives trouble):

```powershell
supabase secrets set GITHUB_APP_ID=123456 GITHUB_WEBHOOK_SECRET=<the secret>
supabase secrets set GITHUB_APP_PRIVATE_KEY="$(Get-Content -Raw .\your-app.private-key.pem)"
```

**How you will know:** the connection check shows all three as set, and the key as **readable**. If it still says "not set" right after you added it, redeploy `integrations` and run the check again.

---

## 6. Install the App

On the App's page choose **Install App**, pick your organisation or account, and choose the repositories it may see (you can add more later). Only repositories you choose here can ever be shown in the Workspace.

**How you will know:** GitHub tells the Workspace, and the installation appears in the **GitHub App** section of Integrations. (It needs the webhook from steps 2 to 5 to be working. If nothing appears, go to step 7.)

---

## 7. Run the connection check, and fix what it says

**Admin, Integrations, GitHub, Connection check, Run the check.** Fix the first problem, run it again, repeat. Anything it could not check shows as **Not checked**, never as OK.

| What it says | What it means and what to do |
|---|---|
| **Database migrations: not found: ...** | Run the file it names in the SQL editor (step 1). |
| **GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET not set** | Add it as an Edge Function secret (step 5), exact name. |
| **Private key: not a usable private key** | Paste the complete `.pem` text including the BEGIN and END lines. |
| **Webhook secret: shorter than 16 characters** | Choose a longer secret; update GitHub and Supabase to the same new value. |
| **GitHub App sign-in: rejected the App's credentials** | The App ID and the private key must come from the **same** App. |
| **App permissions (read): the App is missing ...** | In the App's settings, set the named permission(s) to Read-only. Do not forget **Checks**. |
| **App webhook events: not subscribed to ...** | Tick the named events under Subscribe to events. |
| **Permissions granted to the installation: ... organisation has not accepted** | You changed the App's permissions; an organisation **owner** must approve the update in GitHub (GitHub emails them). Until then the old permissions apply. |
| **Installation: not selected / token could not be made** | Press **Use this installation** (step 8), or reinstall the App if it was removed or suspended. |
| **Webhook deliveries: status 401** | The secret in Supabase does not match the secret in the App. Set both to the same value. |
| **Webhook deliveries: status 404** | The webhook URL is wrong, or `github-webhook` is not deployed. |
| **Webhook deliveries: status 503** | `GITHUB_WEBHOOK_SECRET` is not set on the server. |
| **Webhook deliveries: other 5xx** | The receiver failed. Look at the `github-webhook` function logs, and check the migrations are run. |
| **Webhook deliveries: no deliveries yet** | Make sure the webhook is **Active**, then make a change in a repository or use **Redeliver** on the App's Advanced tab. |
| **Vercel project: could not find / rejected the token** | Check the project name or id, the team, and `VERCEL_TOKEN` (step 12). |

---

## 8. Choose the installation, then link repositories

1. In Integrations, in the **GitHub App** section, press **Use this installation**. The server makes a real token and a real call before saving, and saves nothing if either fails.
2. In **Repositories shown in the Workspace**, choose a repository and a department (or project) and link it. Only linked repositories are visible, and only to the people of that department or project.

**How you will know:** the card says it is connected through the GitHub App, and the Frontend, Backend or DevOps department sees the repository under **Code & activity**.

---

## 9. Prove the webhook

Make a small change in a linked repository (a commit to a branch is enough). Within a minute or so it should appear under **Code & activity, Activity**, and the connection check's **Webhook deliveries** should show OK.

---

## 10. Schedule the background job

`workspace-sweep` trims the GitHub history to 90 days, closes any change request that never got an answer, and does the monitoring and support checks. It only runs if something calls it.

1. Set the secret `WORKSPACE_SWEEP_SECRET` in Supabase (a long random value, at least 24 characters).
2. Make a scheduler (for example Supabase's scheduled jobs, or any cron service) send `POST https://<your-project-ref>.supabase.co/functions/v1/workspace-sweep` with the header `x-sweep-secret: <that secret>`, every 1 to 2 minutes. Details: `docs/workspace/UPDATE_CUSTOMER_SERVICE.md`.

Nothing in the Workspace can detect this, so you tick it yourself in the Setup guide.

---

## 11. Optional: let people comment and open issues from the Workspace

Off by default, on purpose. Seeing a repository never lets anyone change it.

1. In the App's settings, change **Issues** and **Pull requests** to **Read & write**, and have an organisation owner approve the change.
2. In **Repositories shown in the Workspace**, for each repository choose who may: **Off** (nobody, including you), **Admins only** (you, that department's admins, or the project owner), or **Everyone who can see it**. Clients can never write.
3. Try it first on a throwaway repository. Comments appear on GitHub as the App, signed with the person's name. The Integrations page lists every attempt, including refused ones.

---

## 12. Optional: show deployments from Vercel

1. In Vercel, create an access token (account menu, Settings, Tokens). Vercel tokens cannot be limited to read-only: if your plan has a **Viewer** role, create the token from an account with that role. (I could not verify your plan's options.)
2. Add it in Supabase as the secret `VERCEL_TOKEN`.
3. In **Repositories shown in the Workspace**, for each repository enter its **Vercel project** name (or `prj_...` id) and the team if there is one, then **Connect deployments**.

**How you will know:** the connection check shows each project as OK, and the **Deployments** tab appears with real data. The Workspace only ever reads from Vercel.

---

## 13. Looking after it

- **Replace the private key:** in the App's settings generate a new key, put its text into `GITHUB_APP_PRIVATE_KEY`, run the check, then delete the old key in GitHub.
- **Replace the webhook secret:** change it in Supabase and in the App's webhook box, one straight after the other. Deliveries in the gap fail with 401; use **Redeliver** afterwards.
- **If a key or secret may have leaked:** delete the private key in the App's settings straight away (the Workspace's GitHub access stops), generate a new one, update the Supabase secret, and rotate the webhook secret. If a Vercel token leaked, delete it in Vercel and make a new one.
- **Stop all GitHub access:** uninstall the App from the organisation, or delete its private key. **Stop writing only:** set each repository's Comments and New issues to **Off**, or put the App back to Read-only.

---

## The things people most often miss

- [ ] The webhook function is deployed with `--no-verify-jwt`.
- [ ] The **Checks** permission is set, and a new permission has been **approved by an organisation owner**.
- [ ] The webhook secret is **identical** in GitHub and in Supabase, and at least 16 characters.
- [ ] The private key is the **whole** `.pem` text.
- [ ] The App is **installed** on the organisation and on the repositories you want.
- [ ] **Use this installation** was pressed.
- [ ] Repositories are **linked** to a department or project.
- [ ] Comments and New issues are **Off** until you choose otherwise (that is the safe default, not a fault).
- [ ] The background job is **scheduled**.

---

## What has and has not been verified

Everything in the Workspace was tested with fakes and checked against GitHub's and Vercel's **documentation**; **none of it has run against a real GitHub or a real Vercel yet.** That is exactly what the connection check is for: run it, fix what it names, and send me what it says (it never contains a secret) if anything is unclear. The first real comment should be made on a throwaway repository.
