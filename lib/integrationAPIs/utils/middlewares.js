function requestBodyJSONMiddleware(request, response, next) {
    let data = "";

    request.on('data', (chunk) => {
        data += chunk;
    });

    request.on('end', () => {
        if (!data.length) {
            request.body = undefined;
            return next();
        }

        request.body = data;
        next();
    });
}

function getIntegrationAPIsAuthorizationMiddleware(server) {
    const BASE_PATH = "/integration/*";
    const READ_SCOPE = "read";
    const WRITE_SCOPE = "write";
    const SCOPES = [READ_SCOPE, WRITE_SCOPE];
    const WHITELISTED_PATHS = ["/integration/audit"];
    const APP_NAME = "DSU_Fabric";
    const apihub = require("apihub");
    const crypto = require("opendsu").loadAPI("crypto");
    server.use(BASE_PATH, async (req, res, next) => {
        const secretsServiceInstance = await apihub.getSecretsServiceInstanceAsync();
        if (req.headers["x-api-key"] && await secretsServiceInstance.validateAPIKey(req.headers["x-api-key"])) {
            next();
            return;
        }
        const userId = req.headers["user-id"];
        const secretName = crypto.sha256JOSE(APP_NAME + userId, "base64url");
        let secret;
        let apiKey;
        try {
            secret = secretsServiceInstance.getSecretSync(secretsServiceInstance.constants.CONTAINERS.USER_API_KEY_CONTAINER_NAME, secretName);
            secret = JSON.parse(secret);
            if (Object.keys(secret).length === 0) {
                throw new Error("Invalid secret");
            }
            apiKey = JSON.parse(Object.values(secret)[0]);
        } catch (e) {
            res.statusCode = 401;
            res.end(`User ${userId} is not authorized`);
            return;
        }

        if (!SCOPES.includes(apiKey.scope)) {
            res.statusCode = 401;
            res.end(`User ${userId} does not have the necessary permissions`);
            return;
        }

        if (apiKey.scope === READ_SCOPE) {
            if (WHITELISTED_PATHS.some(path => req.url.includes(path))) {
                next();
                return;
            }

            if ((req.method === "PUT" || req.method === "POST" || req.method === "DELETE")) {
                res.statusCode = 401;
                res.end(`User ${userId} does not have write access`);
                return;
            }
        }

        next();
    });
}

function ThrottlerMiddleware(server, config) {
    const TokenBucket = require("apihub").TokenBucket;
    const defaultUpdateProductOrBatchConfig = {
        startTokens: 30,
        tokenValuePerTime: 1,
        unitOfTime: 2000
    }

    const defaultUpdateEPIConfig = {
        startTokens: 10,
        tokenValuePerTime: 1,
        unitOfTime: 2000
    }

    if (!config) {
        config = {};
    }

    const updateProductsAndBatchesConfig = config.updateProductOrBatch || defaultUpdateProductOrBatchConfig;
    const updateEPIsConfig = config.updateEPI || defaultUpdateEPIConfig;

    const updateProductAndBatchesTokenBucket = new TokenBucket(updateProductsAndBatchesConfig.startTokens, updateProductsAndBatchesConfig.tokenValuePerTime, updateProductsAndBatchesConfig.unitOfTime);
    const updateEPIsTokenBucket = new TokenBucket(updateEPIsConfig.startTokens, updateEPIsConfig.tokenValuePerTime, updateEPIsConfig.unitOfTime);

    function getThrottlerMiddleware(tokenBucket) {
        return function throttlerMiddleware(req, res, next) {
            tokenBucket.takeToken("*", 1, (err) => {
                if (err) {
                    if (err === TokenBucket.ERROR_LIMIT_EXCEEDED) {
                        res.statusCode = 429;
                    } else {
                        res.statusCode = 500;
                    }

                    res.end();
                    return;
                }
                next();
            });
        }
    }

    server.put("/integration/product/:gtin", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));
    server.post("/integration/product/:gtin", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));

    server.put("/integration/image/:gtin", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));
    server.post("/integration/image/:gtin", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));

    server.put("/integration/batch/:gtin/:batchNumber", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));
    server.post("/integration/batch/:gtin/:batchNumber", getThrottlerMiddleware(updateProductAndBatchesTokenBucket));

    server.put("/integration/epi/*", getThrottlerMiddleware(updateEPIsTokenBucket));
    server.post("/integration/epi/*", getThrottlerMiddleware(updateEPIsTokenBucket));
}


/**
 * Middleware for limiting concurrent requests.
 *
 * @constructor
 * @param {number} maxConcurrentRequests - The maximum number of concurrent requests allowed.
 * @param {number} [requestTimeout=60000] - The timeout for each request in milliseconds.
 */
function RequestLimiter(maxConcurrentRequests, requestTimeout = 60000) {
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.currentRequests = 0;

    this.requestMiddleware = (req, res, next) => {
        if (this.currentRequests >= this.maxConcurrentRequests) {
            res.statusCode = 429;
            res.end('Too many requests. Please try again later.');
            return;
        }

        this.currentRequests++;

        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                res.statusCode = 408;
                res.end('Request timeout. Please try again.');
            }
        }, requestTimeout);

        const finalize = () => {
            clearTimeout(timeoutId);
            this.currentRequests--;
        };

        res.on('finish', finalize);
        res.on('close', finalize);

        next();
    };
}

const getRequestLimiterMiddleware = (server) => {
    let config = server.config["componentsConfig"]["integration-api"]["requestLimiterConfig"]
    if (!config) {
        config = {}
    }
    config.metadataCapacity = config.metadataCapacity || 5;
    config.epiCapacity = config.epiCapacity || 5;
    const metadataRequestLimiter = new RequestLimiter(config.metadataCapacity);
    const epiRequestLimiter = new RequestLimiter(config.epiCapacity);

    server.put("/integration/product/*", metadataRequestLimiter.requestMiddleware);
    server.post("/integration/product/*", metadataRequestLimiter.requestMiddleware);

    server.put("/integration/batch/*", metadataRequestLimiter.requestMiddleware);
    server.post("/integration/batch/*", metadataRequestLimiter.requestMiddleware);

    server.put("/integration/image/*", metadataRequestLimiter.requestMiddleware);
    server.post("/integration/image/*", metadataRequestLimiter.requestMiddleware);

    server.post("/integration/audit/*", metadataRequestLimiter.requestMiddleware);

    server.delete("/integration/epi/*", epiRequestLimiter.requestMiddleware);
    server.put("/integration/epi/*", epiRequestLimiter.requestMiddleware);
    server.post("/integration/epi/*", epiRequestLimiter.requestMiddleware);
};

module.exports = {
    requestBodyJSONMiddleware,
    getIntegrationAPIsAuthorizationMiddleware,
    ThrottlerMiddleware,
    getRequestLimiterMiddleware
}