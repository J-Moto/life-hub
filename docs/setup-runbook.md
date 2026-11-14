# Life Hub setup runbook: steps 3–7

Do one step, check it worked, then move on. If anything shows a red error, stop and paste it into the Life Hub chat.
Everything in `code blocks` gets pasted into the **Ubuntu terminal** unless the step says otherwise.

To open Ubuntu: PowerShell → type `wsl` → Enter → type `cd ~` → Enter.

---

## Step 3: VS Code connected to Ubuntu (5 min)

**Where:** VS Code, then the Ubuntu terminal.

1. In VS Code, open Extensions (Ctrl+Shift+X). Install **WSL** (Microsoft) and **Claude Code** (Anthropic).
2. In the Ubuntu terminal:
   ```
   mkdir -p ~/life-hub && cd ~/life-hub && code .
   ```
3. VS Code opens a new window. The bottom-left corner should say **WSL: Ubuntu**. If it asks to trust the folder, say yes.

✅ Done when the bottom-left says WSL: Ubuntu.

---

## Step 4: GitHub repo, public and locked down (15 min)

**Where:** the terminal inside VS Code (Ctrl+`), then github.com.

**4a. Sign in to GitHub.**
```
gh auth login
```
Pick: GitHub.com → HTTPS → Yes (authenticate Git) → Login with a web browser. Copy the code it shows, press Enter, paste the code in the browser.

**4b. Set your commit name, plus a private email so your real email never appears in the public history.**
In a browser, go to github.com → Settings → Emails. Turn on **Keep my email addresses private** and copy the `…@users.noreply.github.com` address. Then:
```
git config --global user.name "Joseph Moto"
git config --global user.email "PASTE-NOREPLY-ADDRESS-HERE"
git config --global init.defaultBranch main
```

**4c. Put the starter files in.** Download `life-hub-starter.zip` from the chat to your Windows Downloads folder, then:
```
sudo apt install -y unzip gitleaks
cd ~/life-hub
WINUSER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
unzip -o "/mnt/c/Users/$WINUSER/Downloads/life-hub-starter.zip" -d ~/life-hub
ls -la
```
You should see `CLAUDE.md`, `DESIGN.md`, `README.md`, `docs`, `src`, `test`, `public`, `.claude`, `.github`, `.githooks` and `.gitignore`.

Then install the project's packages and check the starter code works:
```
npm ci
npm test
npm run typecheck
```
Tests should say **all passed**. Typecheck prints nothing when it's happy.

**4d. Turn on the secret blocker (gitleaks).**
```
chmod +x .githooks/pre-commit
git init
git config core.hooksPath .githooks
gitleaks detect --no-git --source . --redact -v
```
The last line should end with **no leaks found**.

**4e. First commit, and create the public repo.**
```
git add -A
git commit -m "Initial plan, rules and security setup"
gh repo create life-hub --public --source=. --remote=origin --push --description "Personal dashboard: calendar, tasks and habits on Cloudflare Workers"
```
If the commit is blocked with a gitleaks warning, stop and paste it into chat. **Don't** work around it.

**4f. Turn on GitHub's free security features.** In the browser: your repo → **Settings → Advanced Security** (it may be called "Code security"). Turn on:
- Private vulnerability reporting
- Dependabot alerts
- Dependabot security updates
- Secret scanning (alerts)
- Push protection
- CodeQL analysis → **Set up → Default**. If it says there's no supported language yet, come back after the first code is pushed.

**4g. Optional, can wait: CodeRabbit** (the independent reviewer from another company). Go to coderabbit.ai → sign in with GitHub → install it on **only** the `life-hub` repo.

✅ Done when the repo shows up on github.com with your files, and the security toggles are on.

---

## Step 5: Cloudflare (5 min)

**Where:** cloudflare.com, then the terminal.

1. Create a free account at dash.cloudflare.com if you don't have one.
2. Check: is **josephmoto.com** already listed on your Cloudflare dashboard? Write down yes or no. It's an open question in the design doc.
3. In the terminal:
   ```
   cd ~/life-hub
   npx wrangler login
   ```
   It asks to install wrangler: say yes. A browser page asks you to allow access: click **Allow**.
   If the browser page fails to return, press Ctrl+C and paste the error into chat.
4. Check:
   ```
   npx wrangler whoami
   ```

✅ Done when `whoami` shows your Cloudflare email.

---

## Step 6: Claude Code add-ons and sandbox (10 min)

**Where:** the terminal inside VS Code, in `~/life-hub`.

**Before 6a–6c:** these commands download third-party code. If any one asks to install something you didn't expect, say no and paste it into chat. After installing, glance at the new files in `.claude/skills/` (they're plain text).

**6a. Skills (they install into this project):**
```
npx skills@latest add mattpocock/skills --skill grill-me --skill grilling --agent claude-code
npx skills@latest add obra/superpowers --skill test-driven-development --agent claude-code
```
If a command asks where to install, choose **this project**, not global.

**6b. Plugins:**
```
claude plugin marketplace add google/elephant-goldfish-model
claude plugin install egm@egm
```
Then start Claude Code:
```
claude
```
Inside Claude Code, type each of these and press Enter:
```
/plugin install security-guidance@claude-plugins-official
/sandbox
```
For `/sandbox`, choose to turn it on. If it warns about **AppArmor**, copy the warning into chat before going further.

**6c. One-time safety scan of your Claude setup** (in the terminal, not inside Claude). Press Ctrl+C twice to leave Claude first:
```
npx -y ecc-agentshield scan
```
Paste the grade into chat.

**6d. Save the setup:**
```
git add -A
git commit -m "Add skills, plugins and sandbox settings"
git push
```

✅ Done when the scan gives a grade and the push works.

---

## Step 7: The interview (Fable, about 45 min, before Monday)

**Where:** Claude Code inside VS Code.

```
claude
```
Then:
```
/model
```
Choose **Fable 5.2**. Then:
```
/effort high
```
Then paste this:
```
/grill-me Use docs/design/v1.md as the starting point. It already has a recommended answer for every decision. Go through them in order and ask me to keep, change or discuss each one, grouped in small rounds. Settle the six open questions in section 4. Update docs/design/v1.md as we go. Don't write any code.
```

After that:
```
/egm:egm-review docs/design/v1.md
```
Fix what it finds that you agree with, then commit:
```
git add -A && git commit -m "Design v1 reviewed" && git push
```

✅ Done when v1.md has no ❓ left and the EGM review has been run.

---

## What comes after (each gets its own exact steps when you get there)

8. Pick a mockup direction and fill in DESIGN.md (Sonnet).
9. Build, one branch per feature (Sonnet, with Fable or Opus for the login/token code).
10. Review gates, polish, deploy.
11. Weekly security scout scheduled task.
