# Club Wheel

A GitHub Pages wheel game backed by a private Google Sheet. Every remaining entry is one chance to win. Winners are staged in the browser during the event; **Done** saves them to the sheet together.

## What the sheet contains

Create a Google Sheet with exactly these two tabs and headers in row 1:

| Participants |  |  |
| --- | --- | --- |
| ID | Name | Entries |

| Winners |  |
| --- | --- |
| ID | Name |

Add one participant per row. `ID` must be unique and stable, `Name` can repeat, and `Entries` must be a nonnegative whole number. Entries determine the participant's chance on the wheel. Leave the Winners tab empty below its header; the game appends confirmed wins there.

## Deploy the Google Sheets backend

1. Open the sheet and select **Extensions → Apps Script**. Replace the default `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). Add an HTML file named `Bridge` and paste [`apps-script/Bridge.html`](apps-script/Bridge.html). In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**, then replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json).
2. In the Apps Script editor, open **Services (+)** and add **Google Sheets API**. In **Project Settings → Script properties**, add `SPREADSHEET_ID` with the ID from the sheet URL (the part between `/d/` and `/edit`). Add `PUBLIC_ORIGIN` with the future GitHub Pages origin, for example `https://YOUR-USERNAME.github.io` (no trailing slash or repository path).
3. Run `getState` once from the editor and approve its Google permissions. Then select **Deploy → New deployment → Web app**, set **Execute as: Me** and **Who has access: Anyone**, and deploy. Copy the `/exec` web app URL. A direct visit to the backend URL may show an empty bridge page; that is expected.
4. Paste that URL into [`config.js`](config.js) as `appsScriptUrl`.

The backend runs under the sheet owner's account; the sheet does **not** need public sharing. The web app itself is public: anyone with the game URL can spin, stage winners, or press Done. Share the game link only with people you trust to operate it.

## Publish the GitHub Pages game

1. Create a GitHub repository and place the contents of this directory at its root. Commit and push to `main`.
2. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the build and deployment source. The included [workflow](.github/workflows/pages.yml) publishes on each push to `main`.
3. Open the Pages URL and verify that the wheel shows **CONNECTED**. If you change `config.js`, push a new commit. If you change Apps Script code, create a new Apps Script deployment version or edit the existing deployment to the new version.

For a project repository, the game URL is normally `https://YOUR-USERNAME.github.io/REPOSITORY/`; `PUBLIC_ORIGIN` is still only `https://YOUR-USERNAME.github.io`.

## Run locally

Serve the directory over HTTP, such as `python3 -m http.server 8000`, then open `http://localhost:8000/`. For a local backend connection, temporarily set `PUBLIC_ORIGIN` to `http://localhost:8000` **and** relax the HTTPS-only origin check in `getPublicOrigin_` while testing; restore the GitHub Pages origin before deployment. You can run pure logic tests with `node --test tests/*.test.mjs`.

## How draws work

- The game loads the participant and winner lists when it opens.
- **Spin** chooses a weighted winner in the browser and starts the wheel animation immediately. The pending result survives a page reload in the same browser.
- **Add winner** stages that person's ID and name in browser storage and subtracts one entry from the local wheel. People with more entries can win again. Nothing is written to the sheet yet.
- **Void draw** asks for a reason, then discards only the pending result. The reason is not saved.
- **Done** validates the sheet against the session's starting participant list, then writes all entry reductions and winner rows in one atomic Sheets batch. Repeating Done after a lost response does not use more entries.
- **Discard staged** clears the browser session after a confirmation prompt. Check the sheet first if a Done request may already have succeeded.
- The app prevents a new spin while a result is pending. It stops when all local entries reach zero.

If the sheet changes while winners are staged, Done reports a conflict and leaves the browser session intact for review. Use one event device: staged results are visible only in that browser until Done. Reloading the page preserves them, and the sheet remains private.

## Troubleshooting

- **SETUP NEEDED:** Add the Apps Script `/exec` URL to `config.js` and redeploy Pages.
- **OFFLINE:** Check the Apps Script deployment access, `PUBLIC_ORIGIN`, and that the latest script version was deployed.
- **Invalid participant:** Check that the named row has a unique ID, a name, and a numeric whole entry count of zero or more.
- **Request timed out:** Refresh the page, inspect the sheet, and press Done again. The backend recognizes the session ID and checks the written rows before retrying.

The game uses an embedded [Apps Script HTML Service](https://developers.google.com/apps-script/guides/html) bridge and the [Sheets API atomic batch update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate). Apps Script [Lock Service](https://developers.google.com/apps-script/reference/lock/) serializes game operations.
