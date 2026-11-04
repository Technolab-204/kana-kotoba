# Kana & Kotoba — server version

## Start the project in IntelliJ IDEA or another IDE

1. Install Node.js 18 or more recent (https://nodejs.org).
2. In IntelliJ: **File → Open** and select the `kana-kotoba` folder.
3. Open `server.js`, then right-click → **Run 'server.js'**.
   Or: **Run → Edit Configurations → + → npm** with the command `start`.
4. Open http://localhost:3000 in your browser.

No dependencies to install: the server only uses Node.js built-in modules.

## Organization

```
kana-kotoba/
├── server.js           HTTP server, accounts, sessions, progress, league
├── package.json        "npm start" command
├── public/
│   ├── index.html      game interface
│   └── api.js          login, 2FA, avatar and league connected to the server
└── data/               created automatically on first launch
    ├── profils.json    accounts: email, username, avatar, hashed password, encrypted 2FA, hashed backup codes
    ├── level.json      progress of each player, indexed by their uid
    ├── sessions.json   session identifiers (also sent to the browser in an HttpOnly cookie)
    └── secret.key      local AES key that encrypts the 2FA secrets
```

## What is stored, and how

- **Passwords**: never stored in plain text, nor encrypted in a reversible way. They are **hashed** with scrypt and a random salt. Even you cannot read them back: only verification is possible. This is standard practice, and it is safer than encryption.
- **2FA secret**: encrypted with AES-256-GCM using `data/secret.key`, because the server needs to read it back to verify codes.
- **Session**: a random identifier is placed in the `kk_sid` cookie (HttpOnly, SameSite=Lax, valid for 30 days). The browser cannot read it from JavaScript.
- **Progress**: saved in `level.json` under the account's uid. The browser sends it after each change (with a half-second delay).

## Do not share

- `data/secret.key`: anyone who has it can decrypt the 2FA secrets. Do not version it (add `data/` to `.gitignore`).
- `data/profils.json`: contains the password hashes. Do not publish it.

## Known limitations

- **No email**: the server does not send any messages. Password reset works with a backup code.
- **Plain HTTP**: locally, everything is sent in clear text. For a public site, you need HTTPS (a reverse proxy such as Caddy or nginx).
- **Progress not verified**: the server trusts the progress sent by the browser. A player can therefore modify their XP. Server-side verification would require recalculating each lesson on the server.
- **No attempt limiting**: nothing prevents looping through password guesses. Add this before any public launch.
- **League**: the leaderboard is read from the server and contains the username, avatar, tier and weekly XP of all players.
- **Old online version**: the page published on claude.ai still uses browser storage. It cannot connect to this local server.
