# Deploy to GitHub Pages & Mobile Access

This guide explains how to deploy the Cesium Pipe Monitoring Dashboard so it can be accessed from mobile browsers.

## Two Parts Required:

### Part 1: Deploy Backend (Flask Server) to Render.com

1. **Push code to GitHub first:**
   
```
bash
   git init
   git add .
   git commit -m "Mobile deployment ready"
   git branch -M main
   git remote add origin https://github.com/Nandagopal-Jakkula/digitaltwin_blackbox.git
   git push -u origin main
   
```

2. **Deploy Backend to Render.com:**
   - Go to https://render.com and sign in with GitHub
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Use these settings:
     - Name: `pipe-monitoring-backend`
     - Build Command: *(leave empty)*
     - Start Command: `python server.py`
     - Free Tier: Yes
   - Click "Create Web Service"
   - Wait for deployment to complete
   - **Copy your backend URL** (e.g., `https://pipe-monitoring-backend.onrender.com`)

### Part 2: Configure Frontend with Backend URL

3. **Edit index.html and add your backend URL:**
   
```
javascript
   // In index.html, change this line:
   window.API_URL = 'https://pipe-monitoring-backend.onrender.com';
   
```

4. **Push the updated code:**
   
```
bash
   git add .
   git commit -m "Add backend URL for mobile"
   git push origin main
   
```

### Part 3: Deploy Frontend to GitHub Pages

5. **Enable GitHub Pages:**
   - Go to your repo: https://github.com/Nandagopal-Jakkula/digitaltwin_blackbox
   - Go to Settings → Pages
   - Under "Build and deployment":
     - Source: Deploy from a branch
     - Branch: main (or master)
     - Folder: /
   - Click Save

6. **Wait 2-3 minutes** for deployment

## Access from Mobile

Once deployed, open your phone browser and go to:
```
https://nandagopal-jakkula.github.io/digitaltwin_blackbox/
```

The dashboard will:
- Load the 3D pipe network
- Connect to your Render.com backend
- Display real-time sensor data
- Work with touch gestures for navigation

## Troubleshooting

**If data doesn't load:**
- Check browser console for errors
- Verify your Render.com backend is running
- Make sure you updated `window.API_URL` in index.html

**If 3D viewer doesn't load:**
- Requires internet connection for Cesium assets
- Check if Cesium Ion token is valid

**For local testing:**
- Keep `window.API_URL = ''` (empty) in index.html
- Run `python server.py` locally
- Access via `http://127.0.0.1:5000`
