const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

async function run() {
    try {
        const apiToken = core.getInput('api-token', { required: true });
        const workspaceId = core.getInput('workspace-id', { required: true });
        const appPath = core.getInput('app-path');
        const appUrl = core.getInput('app-url');
        const platform = core.getInput('platform', { required: true });
        const parentAppId = core.getInput('parent-app-id', { required: true });
        // Default to production API if not provided
        const apiBaseUrl = core.getInput('api-base-url') || 'https://mobileapi.rova.qa/api';
        const APP_ROUTE = `${apiBaseUrl}/apps`;

        if (!appPath && !appUrl) {
            throw new Error('You must provide either `app-path` or `app-url`.');
        }

        const headersContext = {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        };

        // Initialize Context
        const payload = github.context.payload;
        const vcsProvider = 'github';
        const vcsRepository = `${github.context.repo.owner}/${github.context.repo.repo}`;
        let vcsBranch = github.context.ref.replace('refs/heads/', '');
        let vcsCommitHash = github.context.sha;
        let vcsPullRequestId = null;

        if (github.context.eventName === 'pull_request') {
            vcsBranch = payload.pull_request.head.ref;
            vcsCommitHash = payload.pull_request.head.sha;
            vcsPullRequestId = payload.pull_request.number;
        }

        // If URL provided, do a single API call to the unified CI upload
        if (appUrl) {
            core.info(`Triggering Rova deployment via URL: ${appUrl}`);
            const response = await axios.post(`${APP_ROUTE}/ci/upload`, {
                workspaceId,
                platform,
                appUrl,
                vcsProvider,
                vcsRepository,
                vcsBranch,
                vcsCommitHash,
                vcsPullRequestId,
                parentAppId,
                appId: parentAppId // Backward compatibility
            }, { headers: headersContext });

            core.info('✅ Successfully instructed Rova to fetch from URL!');
            core.info(`App ID: ${response.data.app?.buildId || 'Unknown'}`);
            core.info(`Build Status: AI Test suite generation triggered.`);
            return;
        }

        // Otherwise fallback to Chunked Upload
        if (!fs.existsSync(appPath)) {
            throw new Error(`The file ${appPath} does not exist.`);
        }

        const stats = fs.statSync(appPath);
        const fileSize = stats.size;
        const filename = path.basename(appPath);

        core.info(`Uploading ${filename} (${Math.round(fileSize / 1024 / 1024)}MB) sequentially from local runner...`);

        // 1. Initialize Upload
        const initUrl = `${APP_ROUTE}/${parentAppId}/builds/upload/init`;

        core.info(`Initializing upload session...`);
        const initResponse = await axios.post(initUrl, {
            filename,
            fileSize,
            platform,
            chunkSize: CHUNK_SIZE,
            vcsProvider,
            vcsRepository,
            vcsBranch,
            vcsCommitHash,
            vcsPullRequestId,
            workspaceId
        }, { headers: headersContext });

        const uploadId = initResponse.data.uploadId;
        const serverChunkSize = initResponse.data.chunkSize || CHUNK_SIZE;
        const totalChunks = initResponse.data.totalChunks || Math.ceil(fileSize / serverChunkSize);

        core.info(`Upload session initialized: ${uploadId} (${totalChunks} chunks)`);

        // 2. Upload Chunks
        const fileDescriptor = fs.openSync(appPath, 'r');

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * serverChunkSize;
            const end = Math.min(start + serverChunkSize, fileSize);
            const size = end - start;

            const buffer = Buffer.alloc(size);
            fs.readSync(fileDescriptor, buffer, 0, size, start);

            const chunkChecksum = crypto.createHash('md5').update(buffer).digest('hex');

            core.info(`Uploading chunk ${chunkIndex + 1}/${totalChunks}...`);

            const chunkUrl = `${APP_ROUTE}/${parentAppId}/builds/upload/chunk/${uploadId}`;

            await axios.post(chunkUrl, buffer, {
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/octet-stream',
                    'x-chunk-index': chunkIndex.toString(),
                    'x-chunk-checksum': chunkChecksum
                },
                maxBodyLength: Infinity
            });
        }

        fs.closeSync(fileDescriptor);

        // 3. Complete Upload
        core.info('Finalizing upload and triggering AI tests...');
        const completeUrl = `${APP_ROUTE}/${parentAppId}/builds/upload/complete/${uploadId}`;

        const completeResponse = await axios.post(completeUrl, {
            finalChecksum: null // Optional: compute whole file sha256
        }, { headers: headersContext });

        core.info('✅ Successfully uploaded to Rova AI!');
        core.info(`App ID: ${completeResponse.data.app?.id || 'Unknown'}`);
        core.info(`Build Status: AI Test suite generation triggered.`);

    } catch (error) {
        const message = error.response ? JSON.stringify(error.response.data) : error.message;
        core.setFailed(`Rova upload failed: ${message}`);
    }
}

run();
