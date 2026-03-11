# Rova Mobile Application Test Action

This custom GitHub Action allows you to seamlessly upload your compiled Android (`.apk`) or iOS (`.ipa`) builds directly to the Rova Platform from your CI/CD pipeline. 

When a build is uploaded via this Action on a Pull Request, Rova will automatically:
1. Fetch the PR Description and Code Diff.
2. Generate AI-driven testing goals.
3. Execute the tests autonomously on the uploaded build.
4. Report the results back to your PR and Slack.

## Usage

### Method 1: Using an App File Path (Direct Upload)
This approach reads the compiled file directly from the GitHub runner and chunk-uploads it to our servers.

```yaml
name: Mobile CI

on:
  pull_request:
    branches: [ main ]

jobs:
  build_and_test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      # ... (Run your Gradle/Xcode build steps here) ...

      - name: Upload to Rova AI
        uses: GetScandium/rova-upload-action@v1
        with:
          api-token: ${{ secrets.ROVA_API_TOKEN }}
          workspace-id: ${{ secrets.ROVA_WORKSPACE_ID }}
          app-path: 'app/build/outputs/apk/release/app-release.apk'
          platform: 'android'
          parent-app-id: 'uuid of app on rova'
```

### Method 2: Using an App URL (S3/GCP/Firebase Link)
If your CI pipeline already uploads your build to a bucket that generates a publicly accessible or signed URL, you can pass the URL directly instead of uploading the file from the runner.

```yaml
      - name: Trigger Rova AI 
        uses: GetScandium/rova-upload-action@v1
        with:
          api-token: ${{ secrets.ROVA_API_TOKEN }}
          workspace-id: ${{ secrets.ROVA_WORKSPACE_ID }}
          app-url: ${{ steps.upload_to_s3.outputs.file_url }}
          platform: 'android'
          parent-app-id: 'uuid of app on rova'
```

### Building this Action (For Contributors)
Because the `node_modules` are not checked into this repository, you must compile this action into a single `dist/index.js` file before packaging a release:

```bash
npm install
npm run build # (Executes `ncc build index.js -o dist`)
```
