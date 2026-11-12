# FileFleet MCP server

An MCP server that tells AI assistants what upload forms accept, checks files against those rules, and makes links that fix files to fit. It powers FileFleet in Claude, ChatGPT and any other MCP client.

- **Hosted endpoint:** `https://mcp.filefleet.io/mcp` (Streamable HTTP, stateless, no authentication, free)
- **Official MCP Registry:** `io.filefleet/filefleet`
- **Website:** [filefleet.io](https://filefleet.io/?utm_source=github&utm_medium=readme) · [Setup guide](https://filefleet.io/ai-assistants/?utm_source=github&utm_medium=readme)

## What it does

| Tool | What it does |
|---|---|
| `find_upload_requirements` | The exact rules for a form's uploads: pixel sizes, file size limits, head and eye position, the official source and the date it was checked, plus the FileFleet page that makes a file that passes. |
| `check_file` | Whether a form will accept a file, from the file's details (type, size in bytes, pixel size, page count). Returns each rule as passed or failed, and where to fix it. |
| `make_requirement_link` | A filefleet.io link with a form's rules (accepted types, size limits, pixel sizes, file naming). Anyone who opens it can fix their files to match, on their own device. In hosts that support MCP Apps, the rules also show in the chat, where people can drop in files to check them. |

All three tools are read-only.

Forms covered today include US passport and visa (DS-160) photos, the Green Card (DV) lottery, Schengen visas, UK online passports, the India e-Visa and OCI card, China's online visa form, and Indian exam uploads (NEET, JEE Main, CUET, GATE, IBPS and SBI Clerk). The full list, with sources, is at [filefleet.io/requirements.json](https://filefleet.io/requirements.json). Every rule comes from the issuer's own published guidance, and each form is re-checked against its source every month.

## Privacy: what the server receives and keeps

The server never receives files.

- **It receives** only what an assistant sends to a tool: the words searched for (such as "US visa photo"), a form's rules, and, to check a file, that file's details: name, size, type, pixel size, page count and whether it has a password.
- **It keeps nothing.** Each request is handled in memory and discarded when the answer is sent. There are no accounts, no analytics and no tracking in this code, and it logs nothing it receives (only error messages, if something breaks).
- **The in-chat view** reads files on the person's device to check them, and doesn't send them anywhere. Fixing happens on filefleet.io, in the person's own browser.

You can confirm all of this in [`server.js`](server.js) and [`rules.js`](rules.js). FileFleet's full privacy policy is at [filefleet.io/privacy](https://filefleet.io/privacy/#ai-assistants).

## Connect an assistant

- **Claude:** in connector settings, choose **Add custom connector**, name it FileFleet, and paste `https://mcp.filefleet.io/mcp`. No sign-in.
- **ChatGPT:** in developer mode, create a connector with `https://mcp.filefleet.io/mcp` and no authentication.
- **Any other MCP client:** use `https://mcp.filefleet.io/mcp` with the Streamable HTTP transport.

Try: "What size does a US visa photo need to be?" or "Make a requirement link for ABC Lettings: PDF or JPG, under 2 MB, named Lastname_ID."

## Run your own

Requires Node.js 20 or later.

```
npm install
npm start
```

It listens on `PORT` (default 3000). The MCP endpoint is `/mcp`, and `/` shows a short status line. Requirements are fetched from `https://filefleet.io/requirements.json` once an hour, with [`requirements-snapshot.json`](requirements-snapshot.json) as the fallback.

To change the in-chat view, edit `view/view-src.js` or `view/view.template.html`, then run `npm run build-view` to rebuild `view/view.html`.

## Need files fixed automatically?

This server looks up rules and checks files; the fixing itself happens in a person's browser on filefleet.io. If your app or AI agent needs files fixed with no browser involved (resized, compressed, converted and renamed to a form's rules, returned through an API), along with higher limits, batches, branded requirement links and files delivered to your own cloud storage, that's **Make it pass**, FileFleet's paid service for businesses and AI agents.

[Join the Make it pass waitlist](https://filefleet.io/developer-api/?utm_source=github&utm_medium=readme) to hear when it opens.

## Ask for a form

Open an issue with the form's name and a link to its official rules (the government, exam body, embassy or visa centre that publishes them). FileFleet only adds forms whose official source can be checked and re-checked.

## License

The code is under the [MIT License](LICENSE). "FileFleet" and the FileFleet logo are trademarks of Circular Motion Capital Management LLC and aren't covered by the license.
