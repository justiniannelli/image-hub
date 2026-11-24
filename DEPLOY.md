# Putting Image Hub online (free, private to your devices)

The app runs on a free Oracle Cloud server, so it's always on. Tailscale links that server to your own
devices, so only they can open it. Nothing is on the public internet.

Use **personal** accounts for everything below, not work ones.

## 1. Put the code on GitHub (private)
1. Sign in at github.com and create a new repository named `image-hub`. Set it to **Private**. Leave
   "Add a README" unticked.
2. On the empty repository's page, click **uploading an existing file**.
3. Open the `image-hub-github` folder, select **everything inside it** (including `.gitignore`,
   `.gitattributes` and the `deploy` folder), and drag it onto the page. Click **Commit changes**.

This folder has no `.env` file, database or images in it, so your API keys never go to GitHub.

## 2. Get Tailscale on your devices
1. Sign up at tailscale.com with a personal Google, Apple, Microsoft or GitHub account.
2. Install Tailscale on your personal computer and your phone, and sign in.
3. In the Tailscale admin console, open **DNS** and make sure **MagicDNS** and **HTTPS Certificates**
   are turned on.

## 3. Create the free Oracle server
1. Sign up at cloud.oracle.com/free. A card is needed for identity checks; Always Free resources are
   not charged. Your **home region** is permanent. Pick one near you.
2. Go to **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 24.04** (the aarch64 version for ARM).
   - Shape: **Ampere, VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory. If you see "out of capacity", try
     again later, or use the AMD **VM.Standard.E2.1.Micro** (also free; the script adds swap for it).
   - SSH keys: choose **Generate a key pair** and **download the private key**. Keep it somewhere safe.
3. Create it, then copy its **Public IP address** from the instance page.

## 4. Install Image Hub on the server
In PowerShell on your personal computer (replace the key path and IP):

```
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR.SERVER.IP
```

(If it complains that the key's permissions are too open, right-click the key file → Properties → Security
and remove every user except yourself.)

Then, on the server, run these lines one at a time:

```
sudo apt update && sudo apt install -y gh git
gh auth login -h github.com -p https -w
gh auth setup-git
gh repo clone YOUR-GITHUB-NAME/image-hub ~/image-hub
bash ~/image-hub/deploy/setup.sh
```

- `gh auth login` shows a code: open github.com/login/device on any device and enter it.
- The setup script asks for an app password and your API keys (typing is hidden), then prints a
  Tailscale sign-in link. Open it and sign in with the same Tailscale account.
- At the end it prints an address like `https://image-hub.your-tailnet.ts.net`. Open it on any device
  signed in to Tailscale.

## Everyday use
- **Update after code changes:** upload the changed files to GitHub, then on the server run
  `bash ~/image-hub/deploy/update.sh`.
- **Back up images and database:** `bash ~/image-hub/deploy/backup.sh`, then copy the file to your computer
  with `scp -i C:\path\to\ssh-key.key ubuntu@YOUR.SERVER.IP:image-hub-backup-*.tar.gz .`
- **See errors:** `journalctl -u image-hub -n 50`
- **Change password or keys:** `sudo nano /etc/image-hub.env`, then `sudo systemctl restart image-hub`.
- **Set spending limits** on your Google AI Studio and OpenAI accounts. Each image costs money.
