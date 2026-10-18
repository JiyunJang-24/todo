# todo

A private, password-protected todo app (todomate-style) that runs on GitHub Pages.

- Todos are encrypted in the browser (PBKDF2-SHA256, 600k iterations → AES-GCM-256) before they leave the device.
- The encrypted file lives in a separate **private** repo (`todo-data/todos.enc.json` by default) and is read/written through the GitHub API.
- The GitHub token is entered once per device and stored only in that browser, encrypted with your password.
- Edits from multiple devices are merged per item (last edit wins); the app works offline and syncs when back online.

This repo only contains the app code. No todo data is ever committed here.

## Setup
1. Create an empty **private** repo for data, e.g. `todo-data`.
2. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new with access to only that repo and **Contents: Read and write**.
3. Enable GitHub Pages for this repo (Settings → Pages → Deploy from branch → `main` / root).
4. Open the site, enter the repo name, token and a password. On other devices, enter the same token (or another one) and the same password.

If you forget the password, the data cannot be recovered.
