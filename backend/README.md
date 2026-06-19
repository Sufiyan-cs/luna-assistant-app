# Luna Assistant Backend

This is the standalone Node.js server for the Luna Assistant app. It manages the WhatsApp connection (via Baileys) and communicates with the NVIDIA AI for responses.

## Deployment to Render (Free)

1. Create an account on [Render.com](https://render.com).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository (`Sufiyan-cs/luna-assistant-app`).
4. Configure the Web Service:
   - **Name**: `luna-backend`
   - **Root Directory**: `backend` (Important!)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**.

Once deployed, Render will give you a URL like `https://luna-backend-xxxxx.onrender.com`.

**In the Luna App:**
Go to Settings -> enter that URL in the "Backend Server URL" field -> Save Settings.

## Note on Free Tier
Render spins down free web services after 15 minutes of inactivity. When it spins down, the WhatsApp connection drops. You can use a free pinging service like [cron-job.org](https://cron-job.org) to ping your Render URL every 10 minutes to keep it awake 24/7.
