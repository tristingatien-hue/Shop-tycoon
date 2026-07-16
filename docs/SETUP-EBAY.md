# Connecting eBay — one-time setup

Total time: about 20 minutes. You need this once; after that the app keeps
itself signed in.

## 1. Create a free eBay developer account

1. Go to <https://developer.ebay.com> → **Register**.
2. Sign in with (or link) the eBay account you **sell** with.
3. Confirm the email verification.

## 2. Create an application keyset

1. In the developer portal, open **Your Account → Application Keys**
   (<https://developer.ebay.com/my/keys>).
2. You'll see two environments: **Sandbox** (fake eBay for testing) and
   **Production** (the real thing). Create a keyset for **Production**
   (use Sandbox first if you want a dry run — the app supports both via
   the *Environment* field).
3. Note down:
   - **App ID (Client ID)**
   - **Cert ID (Client Secret)**

## 3. Create the redirect (RuName)

1. Next to your Production keyset, click **User Tokens** →
   **Get a Token from eBay via Your Application** → **Add eBay Redirect URL**.
2. Fill in anything for the display title. For **Your auth accepted URL** you
   can leave eBay's default "authorization code grant" behavior — after you
   approve the app in the browser, eBay shows/lands on a page whose address
   contains `code=...`, which you paste into the app.
3. Note down the **RuName** (looks like `Your_Name-YourApp-PRD-abc123-xyz`).

## 4. Enter the keys in the app

1. Open the app → **Channels** → **eBay** → **Connect…**
2. Paste App ID, Cert ID, RuName, and set environment (`production` or
   `sandbox`). These are stored encrypted on your PC only.
3. Click **Connect…** again — your browser opens eBay's consent page.
   Sign in with your **seller** account and click **Agree**.
4. Copy the address of the page you land on (it contains `code=...`) and
   paste it into the app. Done — messages and orders start syncing.

## 5. Listing setup (needed only for publishing listings)

Publishing through the API requires your eBay *business policies*:

1. Make sure your seller account is opted in to business policies:
   <https://www.ebay.com/help/policies/business-policy/business-policies>
   (Seller Hub → Account → Business policies). Create at least one shipping,
   payment, and return policy if you don't have them.
2. In the app: **Channels → eBay → Fetch my policies from eBay** — it lists
   your policy IDs and inventory locations. Copy each ID into the fields and
   **Save listing setup**.
3. If you have no inventory location yet, create one in Seller Hub
   (Account → Addresses) or via the API; it's the "ships from" location.
4. Default category ID: `20091` is *Crafts → Woodworking*; you can override
   per template later. Find any category's ID at
   <https://www.ebay.com/sellerhub> when listing manually, or ask me.

## Troubleshooting

- **"invalid_grant" when finishing connect** — the code expires in ~5 minutes;
  redo Connect and paste promptly.
- **Status shows "expired"** — eBay refresh tokens last ~18 months; click
  Connect to sign in again.
- **Publish fails mentioning policies** — step 5 isn't finished; the error
  names exactly which field is missing.
- **Messages sync but replying fails** — eBay's API only allows replies tied
  to a listing; for the rest, the app copies your drafted reply so you can
  paste it on ebay.com.
