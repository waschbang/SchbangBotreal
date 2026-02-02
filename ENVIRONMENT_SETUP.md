# Environment Variables Setup Guide

## Overview

Your application now uses environment variables for Google Service Account credentials instead of committing them to Git. This is more secure and follows best practices.

## How It Works

The app checks for credentials in this order:
1. **Environment Variable** (`GOOGLE_SERVICE_ACCOUNT`) - Used in production (Render)
2. **Local File** (`src/service-account.json`) - Used in local development

## Local Development Setup

### Step 1: Get Fresh Credentials

1. Go to Google Cloud Console: https://console.cloud.google.com/iam-admin/serviceaccounts?project=schbangbo
2. Find or create service account: `schbangbot-new@schbangbo.iam.gserviceaccount.com`
3. Go to "KEYS" tab
4. **Delete all existing keys** (important!)
5. Click "ADD KEY" → "Create new key" → Choose "JSON"
6. Download the JSON file

### Step 2: Place Credentials Locally

1. Rename the downloaded file to `service-account.json`
2. Move it to `src/service-account.json`
3. The file is already in `.gitignore` so it won't be committed

### Step 3: Test Locally

```bash
npm start
```

You should see: `✓ Using Google credentials from service-account.json file`

## Production Setup (Render)

### Step 1: Prepare the Credentials

1. Open your `src/service-account.json` file
2. Copy the ENTIRE contents (it should be valid JSON)

### Step 2: Set Environment Variable in Render

1. Go to your Render Dashboard
2. Select your service
3. Go to "Environment" tab
4. Click "Add Environment Variable"
5. Set:
   - **Key**: `GOOGLE_SERVICE_ACCOUNT`
   - **Value**: Paste the entire JSON content from step 1
6. Click "Save Changes"

### Step 3: Deploy

Render will automatically redeploy with the new environment variable.

Check the logs - you should see: `✓ Using Google credentials from environment variable`

## Share Google Sheets

Don't forget to share your Google Sheets with the service account email!

Find the email in your credentials JSON file under `client_email` field.

Share these spreadsheets with that email as "Editor":
- `1vKSxjnHKSKjc_iWD86W6xTF7bYNtYN8s5K75NNM8LrA`
- `14_CTezwaYLLkhWX3hskm61zXp0sfrCDnIu7bsfZt36w`
- `1OWtO8jYeNFwTpF6movC3o2xDkXlSohTPowiJVYq4cXY`
- `1pmkj8M1FCizk41IlzEnPcnISf6iXd3Ssm7DwwGh60kQ`

## Troubleshooting

### "Invalid JWT Signature" Error

This means the private key is invalid. Solutions:

1. **Delete ALL old keys** in Google Cloud Console
2. Create a fresh new key
3. Download it and use it immediately
4. Update both local file AND Render environment variable

### "No Google credentials found" Error

- **Local**: Make sure `src/service-account.json` exists
- **Render**: Make sure `GOOGLE_SERVICE_ACCOUNT` environment variable is set

### Credentials Not Working After Update

1. **Local**: Restart your server (`Ctrl+C` then `npm start`)
2. **Render**: Trigger a manual redeploy or restart the service

## Security Best Practices

✅ **DO:**
- Use environment variables in production
- Keep `service-account.json` in `.gitignore`
- Rotate credentials periodically
- Delete unused keys in Google Cloud Console

❌ **DON'T:**
- Commit credentials to Git
- Share credentials in chat/email
- Use the same credentials across multiple projects
- Leave old/unused keys active

## Files Modified

The following files now use the centralized auth helper:

- `src/lib/googleAuth.js` (new helper file)
- `src/routes/markFilled.js`
- `src/routes/training.js`
- `src/routes/getMainData.js`
- `src/routes/copyFeedback.js`
- `src/routes/addotherdata.js`
- `src/routes/markServiceFilled.js`
- `src/routes/getBrandInfo.js`
- `src/routes/csatAverage.js`
- `src/routes/userDetails.js`
- `src/routes/checkId.js`

All these files now import from `../lib/googleAuth` instead of creating their own auth instances.
