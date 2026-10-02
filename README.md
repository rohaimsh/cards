# Cards app: going live for company users

Two pieces:

- **The page** (`index.html`): runs on the phone. Card capture, auto crop, contacts list, CSV/JSON export. It makes no network requests except to your card reader: the libraries are built in, there are no web fonts, CDNs or analytics.
- **The card reader**: a Power Automate flow that runs Microsoft's AI Builder business card reader in your tenant and returns the fields.

Data path: photo is cropped on the phone, sent to your flow, fields come back. Contacts stay on the phone until someone exports them.

Your part takes about 15 minutes.

---

## 1. Build the card reader flow (about 10 minutes)

Needs a work account with a **Power Automate Premium** licence (the HTTP trigger is premium). The business card reader itself uses no AI Builder credits.

1. Go to **make.powerautomate.com**. Top right, check the environment is your company's (ideally the UAE region one).
2. **Create → Instant cloud flow.** Name it `Card reader`, choose **When an HTTP request is received**, then Create. (If it isn't in the list, choose Skip and search for it as the trigger.)
3. Open the trigger and set **Who can trigger the flow?** to **Anyone**. Leave the schema empty.
4. **Add an action → search "business card" → AI Builder: Read business card information.**
   - **Business card:** click in the box, choose the expression option (fx), paste this and add it:
     ```
     base64ToBinary(first(json(string(triggerBody()))?['images']))
     ```
   - **Image type:** Detect automatically.
5. **Add an action → Response.**
   - Status code: `200`
   - Headers: `Access-Control-Allow-Origin` = `*` and `Content-Type` = `application/json`
   - Body: paste this, then replace the text inside each pair of quotes with the matching item from the dynamic content list (keep the quotes):
     ```
     {
       "name": "Full name",
       "company": "Company name",
       "title": "Job title",
       "email": "Email",
       "phone": "Mobile phone",
       "businessphone": "Business phone",
       "website": "Website",
       "address": "Full address",
       "department": "Department",
       "fax": "Fax"
     }
     ```
6. **Save.** Open the trigger again and copy the **HTTP URL**. It contains `sig=…`, which works like a password: anyone with the URL can use the reader.

Optional check from a computer:
```
curl -X POST "<flow url>" -H "Content-Type: text/plain" \
  --data "{\"images\":[\"$(base64 -w0 card.jpg)\"]}"
```
You should get the JSON above back with the card's details. (On a Mac use `base64 -i card.jpg` instead of `base64 -w0 card.jpg`.)

## 2. Put the page online (about 3 minutes)

GitHub Pages is free and needs no Azure permissions.

1. Sign in at **github.com** (create an account if you don't have one).
2. **+ → New repository**, name it `cards`, Public, **Create repository**.
3. Click **uploading an existing file**, drag in `index.html`, **Commit changes**.
4. **Settings → Pages.** Source: Deploy from a branch. Branch: `main`, folder `/ (root)`. **Save.**
   After a minute the page is live at `https://<your-username>.github.io/cards/`.

The page contains no data and no reader address, so it's safe to host publicly. Later, the same file moves to Azure Static Web Apps with company sign-in.

## 3. Connect your phone and make the setup link (about 2 minutes)

1. On your iPhone, open the page in Safari → **Share → Add to Home Screen** → open it from the new icon.
2. **Contacts → Card reader settings** → paste the flow URL → **Save**.
3. **Capture → Paper card** → photograph a card. Fields should fill within a few seconds.
4. **Card reader settings → Copy setup link for colleagues** → post it in Teams or email. Share it only inside the company.

## 4. What colleagues do

Open the setup link in Safari on the iPhone, then **Share → Add to Home Screen**. Open the new icon and tap **Connect**. If Safari asks to connect first, either answer is fine; the icon asks again because it keeps its own storage.

The Connect screen shows the reader's address. It should end in `powerplatform.com` or `azure.com`; tell people not to connect anything else.

---

## Troubleshooting

- **"The card reader didn't answer" but the curl check works:** remove the `Access-Control-Allow-Origin` header from the Response step and try again. Some tenants add it automatically, and two copies make the browser reject the answer. Also check the flow's run history for failed runs.
- **Runs fail at the AI Builder step:** confirm AI Builder, and the business card reader in particular, is available in your environment's region.
- **"Anyone" is missing or the trigger is blocked:** your admins restrict anonymous HTTP triggers or a data policy blocks the HTTP connector. Ask IT to allow it for this environment.
- **"The card reader refused this phone":** the flow URL changed. Copy the new URL into Card reader settings and send a fresh setup link.
- **Contacts missing:** the page was opened in Safari instead of the icon (they keep separate lists), or site data was cleared. Export after each event.

## Notes for IT

- Photos go only to your flow, which passes them to AI Builder inside your tenant. Nothing is sent to any other service.
- The setup link carries the flow URL and its signature. To revoke access, turn the flow off. To rotate, use **Save As** to copy the flow (the copy gets a new URL), delete the original, and send a new setup link.
- Anyone holding the link can send images to the flow; runs count against the flow owner's Power Automate request limits. The flow exposes nothing else in the tenant: it only reads the image it's given.
- Contacts live in the phone browser's storage for that site. iPhone Safari can clear data for sites not used for 7 days; the Home Screen icon is exempt from that rule, which is why the app nudges people to install it. Photos are stored reduced (about 50 KB each).
- Next phase, once Azure/Dataverse access is granted: write contacts straight to a Dataverse table instead of CSV, and host the page on Azure Static Web Apps behind Entra sign-in.

## Option B: Claude as the reader

`reader-worker.js` is the same reader using Claude through an Anthropic API key, deployable on Cloudflare Workers' free tier. Setup steps are at the top of the file. Connect phones the same way (paste the worker URL and token in Card reader settings, then share the setup link), and set `readerCareful: true` in the `CONFIG` block of `index.html` to show "Read again carefully".

## Bulk scanning (many cards at once)

`bulk_cards.py` turns flatbed scans into app-ready data.

1. Put the cards on the scanner glass with gaps between them, **lid open** (dark background). Scan at 300 dpi → `front.jpg`.
2. Flip every card in place (left to right). Scan again → `back.jpg`.
3. Run (Python 3 with Pillow; `pip install pillow openpyxl`):
   ```
   python3 bulk_cards.py front.jpg back.jpg --out batch1 --event "GITEX 2026" --reader "<Card reader flow URL>"
   ```
   You get: one image per side, one PDF per card (front page + back page), `all-cards.pdf`, `contact-sheet.jpg` (numbered overview), `cards.xlsx` (one row per card as read by AI Builder, with empty `verified_*` columns) and `cards.json`.
4. Send `cards.json` to the phone (AirDrop or Files), then in the app: Contacts → **Import JSON**. The cards appear with their photos and are sent to Dataverse automatically.
5. Accuracy check: fill the `verified_*` columns in `cards.xlsx` with the true values (or have Claude read the images and save them as a JSON with the same card numbers), then run `python3 bulk_cards.py x --out batch1 --score [--compare verified.json]` to get per-field accuracy.

## Card page (what people see when they scan your QR)

`card.html` is a separate page next to `index.html`. Upload both to the same GitHub folder.

- Try it: `https://<user>.github.io/cards/card.html#demo` shows a sample card. The form works but sends nothing.
- From the app: My card > set "QR opens" to **Web page**. The QR now holds a link to `card.html` with your details inside it (after the `#`, so GitHub never receives them). Anyone scanning sees your card, can save your contact, and (once connected) leave their details.
- These link cards are marked "Shared by link, not verified", because anyone can make such a link. Cards loaded from Dataverse (`card.html?c=ID`) are marked "Verified staff card".
- Settings are at the top of `card.html` (`CONFIG`): `cardUrl` (Get card flow), `leadUrl` (visitor details flow), `privacyUrl`, `allowLinkCards`.
- The visitor form stays hidden on real cards until `leadUrl` is set. Visitor details must go to their own table, not into the staff table, because anyone on the internet can send them.
- Test the **Save contact** button on one iPhone and one Android before showing it to anyone.

## Flows (Power Automate, developer environment)

| Flow | What it does | Who calls it |
|---|---|---|
| Card reader | Reads a card photo with AI Builder | App (Capture) |
| Save contact | Saves a captured contact into **Captured Cards**, replacing a row with the same email | App (Save) |
| Card page lead | Saves a visitor's details from the card page into **Card Leads** | card.html form |
| GCS Get card | Returns a published card by its short id (`card.html?c=ID`) | card.html |
| GCS Publish my card | Checks the Microsoft sign-in, then creates or updates the person's row in **Staff Cards** and returns the short id | App (Publish my card) |

The last two live in the solution **GCS Card Page** (`GCSCardPage_1_0_0_1.zip`, generated by `build_solution.py`). Re-import the zip to update them; the trigger links stay the same.
Trigger links are keys: keep them out of chats and screenshots where possible. The publish link is in `index.html` because the flow verifies the sign-in anyway; the reader and save links travel through the setup link.
