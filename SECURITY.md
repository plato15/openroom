# Security

Openroom holds confidential documents, so security reports are welcome and taken seriously.

**Please do not open a public issue for a vulnerability.** Report it privately through GitHub: the **Security** tab of this repository, then **Report a vulnerability**. Include the steps to reproduce and what an attacker could reach.

## What Openroom promises

- A file is served only to a signed-in investor who is not revoked, not past their end date, and has access to the file's folder, and only if the file is marked Visible. Everything else is a 404.
- Files live in a private R2 bucket and leave it only through the Worker after that check.
- Ids and tokens are 128 or 256 random bits. Only SHA-256 hashes of sign-in tokens and session cookies are stored.
- Form posts must come from the room's own origin. Pages use a strict Content Security Policy with no inline scripts; rendered spreadsheets and Word files run with scripts switched off.

## What it does not promise

Viewing in a browser can always be copied: screenshots, a browser's "save PDF", copying text. Openroom makes leaks traceable (every page is stamped with the viewer's email and the date, and every view is logged); it cannot make them impossible.
