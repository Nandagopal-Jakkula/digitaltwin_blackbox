# How to Update GitHub

After making changes to your code on laptop, run these commands in your project folder:

## Commands:

```bash
git add .
git commit -m "Your description here"
git push origin main
```

## Example:

```
bash
git add .
git commit -m "Fixed dashboard issue"
git push origin main
```

## What happens:

1. `git add .` - Stages all your changes
2. `git commit -m` - Saves your changes locally
3. `git push origin main` - Uploads to GitHub

## After pushing:

- GitHub Pages auto-updates in ~2 minutes
- Your mobile site will show the new changes
