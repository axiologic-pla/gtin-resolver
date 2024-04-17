require("../../../opendsu-sdk/builds/output/testsRuntime");
require('../../../gtin-resolver/build/bundles/gtinResolver');

const dc = require("double-check");
const assert = dc.assert;
const EpiSORIntegrationClient = require("../../lib/integrationAPIs/clients/EpiSORIntegrationClient");
const tir = require("../../../opendsu-sdk/psknode/tests/util/tir");
const path = require("path");
const fs = require("fs");
const NO_PRODUCTS_OR_BATCHES = 5;
const NO_LEAFLETS = 5;

// Function to measure execution time
async function measureApiPerformance(apiFunction, repetitions = NO_PRODUCTS_OR_BATCHES) {
    const start = Date.now();
    const promises = [];

    for (let i = 0; i < repetitions; i++) {
        promises.push(apiFunction());
    }

    try {
        await Promise.all(promises);
        const end = Date.now();
        const duration = end - start;
        console.log(`API executed ${repetitions} times in ${duration} ms`);
    } catch (error) {
        console.error('Error executing API', error);
    }
}

assert.callback("EPISORClient Write API Performance Tests", async (callback) => {
    // Set up API Hub test node (same as in the provided test suite)
    const domain = 'tester.epi';
    const subdomain = 'tester.epi.nah1';
    const language = 'en';
    const productDetails = {
        "messageType": "Product",
        "messageTypeVersion": 1,
        "senderId": "ManualUpload",
        "receiverId": "QPNVS",
        "messageId": "S000001",
        "messageDateTime": "2023-01-11T09:10:01CET",
        "payload": {
            "productCode": "02113111111164",
            "internalMaterialCode": "",
            "inventedName": "BOUNTY",
            "nameMedicinalProduct": "BOUNTY® 250 mg / 0.68 mL pre-filled syringe",
            "strength": ""
        }
    };

    const batchDetails = {
        "messageType": "Batch",
        "messageTypeVersion": 1,
        "senderId": "ManualUpload",
        "receiverId": "QPNVS",
        "messageId": "S000001",
        "messageDateTime": "2023-01-11T09:10:01CET",
        "payload": {
            "productCode": "02113111111164",
            "batchNumber": "B123",
            "packagingSiteName": "",
            "expiryDate": "230600"
        }
    };

    const leafletDetails = require("../leaflet.json");
    const image = require("../image.json");

    const vaultDomainConfig = {
        "anchoring": {
            "type": "FS",
            "option": {}
        },
        "enable": ["enclave", "mq"]
    }

    const folder = await $$.promisify(dc.createTestFolder)("testFolder");
    const serverConfig = {
        "storage": folder,
        "port": 8080,
        "preventRateLimit": true,
        "activeComponents": [
            "bdns",
            "bricking",
            "anchoring",
            "epi-mapping-engine",
            "epi-mapping-engine-results",
            "get-gtin-owner",
            "leaflet-web-api",
            "integration-api",
            "mq",
            "secrets",
            "lightDBEnclave",
            "staticServer"
        ],
        "componentsConfig": {
            "epi-mapping-engine": {
                "module": "./../../gtin-resolver",
                "function": "getEPIMappingEngineForAPIHUB"
            },
            "epi-mapping-engine-results": {
                "module": "./../../gtin-resolver",
                "function": "getEPIMappingEngineMessageResults"
            },
            "leaflet-web-api": {
                "module": "./../../gtin-resolver",
                "function": "getWebLeaflet"
            },
            "get-gtin-owner": {
                "module": "./../../gtin-resolver",
                "function": "getGTINOwner"
            },
            "integration-api": {
                "module": "./../../gtin-resolver",
                "function": "getIntegrationAPIs"
            },
            "staticServer": {
                "excludedFiles": [
                    ".*.secret"
                ]
            },
            "bricking": {},
            "anchoring": {}
        },
        "enableRequestLogger": false,
        "enableJWTAuthorisation": false,
        "enableSimpleAuth": false,
        "enableOAuth": true,
        "enableAPIKeyAuth": true,
        "enableClientCredentialsOauth": true,
        "oauthJWKSEndpoint": "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/discovery/v2.0/keys",
        "enableLocalhostAuthorization": true,
        "skipOAuth": [
            "/assets",
            "/bdns",
            "/bundles",
            "/gtinOwner/",
            "/leaflets/"
        ],
        "oauthConfig": {
            "issuer": {
                "issuer": "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/oauth2/v2.0/",
                "authorizationEndpoint": "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/oauth2/v2.0/authorize",
                "tokenEndpoint": "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/oauth2/v2.0/token",
                "userInfoEndpoint": "https://graph.microsoft.com/oidc/userinfo"
            },
            "client": {
                "clientId": "5daf11d0-dc28-4d09-b8c7-2eec6f16eb78",
                "scope": "email user.read offline_access openid api://5daf11d0-dc28-4d09-b8c7-2eec6f16eb78/access_as_user",
                "redirectPath": "http://localhost:8080/?root=true",
                "clientSecret": "3QA8Q~IXBkF2MUZcfmWWcDlhneLzlp3XI75c1bNT",
                "logoutUrl": "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/oauth2/logout",
                "postLogoutRedirectUrl": "http://localhost:8080/?logout=true"
            },
            "sessionTimeout": 120000,
            "keyTTL": 3600000,
            "debugLogEnabled": false
        },
        "serverAuthentication": true
    }

    process.env.SSO_SECRETS_ENCRYPTION_KEY = "+WG9HhIoXGGSVq6cMlhy2P3vuiqz1O/WAaiF5JhXmnc=";
    process.env.EPI_DOMAIN = domain;
    process.env.EPI_SUBDOMAIN = subdomain;
    process.env.PSK_CONFIG_LOCATION = require("path").join(folder, "external-volume/config");
    const openDSU = require("opendsu");
    const crypto = openDSU.loadAPI("crypto");
    const apiKeyAPIs = openDSU.loadAPI("apiKey");
    const keySSISpace = openDSU.loadAPI("keyssi");
    const http = openDSU.loadAPI("http");
    const systemAPI = openDSU.loadAPI("system");
    systemAPI.setEnvironmentVariable(openDSU.constants.BDNS_ROOT_HOSTS, "https://nah1.dev.pladevs.com")
    const generateEncryptionKey = () => {
        return crypto.generateRandom(32).toString("base64");
    }
    const htPasswordPath = path.join(folder, ".htpassword.secret");
    for (let i = 0; i < 10; i++) {
        const user = `user${i}`;
        const password = `password${i}`;
        const hashedPassword = crypto.sha256JOSE(password).toString("hex");
        const mail = `usr${i}@example.com`;
        const ssoId = `usr${i}@example.com`;
        fs.appendFileSync(htPasswordPath, `${user}:${hashedPassword}:${mail}:${ssoId}\n`);
    }

    const tokenEndpoint = "https://login.microsoftonline.com/d69968dd-8f36-47eb-b724-7f5e6e660066/oauth2/v2.0/token";
    const clientId = "5daf11d0-dc28-4d09-b8c7-2eec6f16eb78";
    const clientSecret = "3QA8Q~IXBkF2MUZcfmWWcDlhneLzlp3XI75c1bNT";
    const scope = "api://5daf11d0-dc28-4d09-b8c7-2eec6f16eb78/.default";
    const getAccessToken = async () => {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('scope', scope);

        let response;
        response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params
        })

        let data = await response.json();
        return data.access_token;
    }

    const accessToken = await getAccessToken();
    const authorization = `Bearer user1:${crypto.sha256JOSE("password1").toString("hex")}`

    const interceptor = (data, callback) => {
        let {url, headers} = data;
        if (!headers) {
            headers = {};
        }

        if (!headers["x-api-key"]) {
            headers["x-api-key"] = process.env.SSO_SECRETS_ENCRYPTION_KEY;
        }

        if (!headers.authorization) {
            headers.authorization = `Bearer ${accessToken}`;
        }

        callback(undefined, {url, headers});
    }

    http.registerInterceptor(interceptor);

    // const {port} = await tir.launchConfigurableApiHubTestNodeAsync({
    //     domains: [{name: domain, config: vaultDomainConfig}, {name: subdomain, config: vaultDomainConfig}],
    //     rootFolder: folder,
    //     serverConfig: serverConfig
    // });
    const apiHub = require("apihub");
    const secretsService = await apiHub.getSecretsServiceInstanceAsync(path.join(apiHub.getServerConfig().storage, "../../apihub-root"));
    const LightDBEnclaveFactory = require("../../../gtin-resolver/lib/integrationAPIs/utils/LightDBEnclaveFactory");
    const lightDBEnclaveFactory = LightDBEnclaveFactory.getLightDBEnclaveFactoryInstance();
    const seedSSI = await $$.promisify(keySSISpace.createSeedSSI)(domain);
    // await secretsService.putSecretInDefaultContainerAsync(lightDBEnclaveFactory.generateEnclaveName(domain, subdomain), seedSSI.base64Encode(seedSSI.getPrivateKey()));

    const client = EpiSORIntegrationClient.getInstance(domain, subdomain);
    // promisify all methods of client
    for (let prop in client) {
        if (typeof client[prop] === 'function') {
            client[prop] = $$.promisify(client[prop]);
        }
    }
    // --- Performance Tests ---
    let existingGTINs = [];

    function generateRandomGTIN14() {
        // Generate the first 13 digits randomly
        let gtinValue = '';
        for (let i = 0; i < 13; i++) {
            gtinValue += Math.floor(Math.random() * 10).toString();
        }

        // Calculate the check digit
        const gtinMultiplicationArray = [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3];

        let gtinDigits = gtinValue.split("");


        let j = gtinMultiplicationArray.length - 1;
        let reszultSum = 0;
        for (let i = gtinDigits.length - 1; i >= 0; i--) {
            reszultSum = reszultSum + gtinDigits[i] * gtinMultiplicationArray[j];
            j--;
        }
        let validDigit = Math.floor((reszultSum + 10) / 10) * 10 - reszultSum;
        if (validDigit === 10) {
            validDigit = 0;
        }

        gtinValue += validDigit;
        existingGTINs.push(gtinValue);
        return gtinValue;
    }

    function generateRandomBatchNumber(length = 10) {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    const updateProductExecutionTime = [];
    // implement sleep function using promises
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const updateProduct = async () => {
        const sleepTime = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;
        // await sleep(sleepTime);
        const gtin = generateRandomGTIN14();
        productDetails.payload.inventedName = `Product ${generateRandomBatchNumber(5)}`;
        productDetails.payload.nameMedicinalProduct = productDetails.payload.inventedName;
        productDetails.payload.productCode = gtin;
        const start = Date.now();
        await client.updateProduct(gtin, productDetails);
        const end = Date.now();
        updateProductExecutionTime.push(end - start);
    }

    // Test for updateProduct
    console.log('Testing updateProduct performance...');
    await measureApiPerformance(updateProduct);
    console.log("Update Product Execution Time", updateProductExecutionTime);
    console.log('Average execution time for updateProduct:', updateProductExecutionTime.reduce((a, b) => a + b) / updateProductExecutionTime.length);

    let products = await client.listProducts();
    if (!products) {
        products = [];
    }
    existingGTINs = existingGTINs.concat(products.map(product => product.productCode));
    const savedGTINs = products.map(product => product.productCode);
    let batches = await client.listBatches();
    if (!batches) {
        batches = [];
    }
    let existingBatchObjects = [];
    if (batches.length) {
        existingBatchObjects = batches.map(batch => {
            return {
                productCode: batch.productCode,
                batchNumber: batch.batchNumber
            }
        });
    }

    const updateBatchExecutionTime = [];
    const updateBatch = async () => {
        const sleepTime = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;
        // await sleep(sleepTime);
        const gtin = savedGTINs[Math.floor(Math.random() * savedGTINs.length)];
        const batchNumber = generateRandomBatchNumber();
        batchDetails.payload.productCode = gtin;
        batchDetails.payload.batchNumber = batchNumber;
        existingGTINs.push(gtin);
        const start = Date.now();
        await client.updateBatch(gtin, batchNumber, batchDetails);
        const end = Date.now();
        updateBatchExecutionTime.push(end - start);
    }
    // Test for updateBatch
    console.log('Testing updateBatch performance...');
    await measureApiPerformance(updateBatch);
    console.log('Average execution time for updateBatch:', updateBatchExecutionTime.reduce((a, b) => a + b) / updateBatchExecutionTime.length);
    const usedGtinsForImages = [];

    const updateImageExecutionTime = [];
    const updateImage = async () => {
        const sleepTime = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;
        // await sleep(sleepTime);
        let gtin;
        do {
            gtin = savedGTINs[Math.floor(Math.random() * savedGTINs.length)];
        } while (usedGtinsForImages.includes(gtin));
        usedGtinsForImages.push(gtin);
        image.payload.productCode = gtin;
        const start = Date.now();
        await client.updateImage(gtin, image);
        const end = Date.now();
        updateImageExecutionTime.push(end - start);
    }
    // Test for updateImage
    console.log('Testing updateImage performance...');
    await measureApiPerformance(updateImage);
    console.log('Average execution time for updateImage:', updateImageExecutionTime.reduce((a, b) => a + b) / updateImageExecutionTime.length);

    const usedGTINsForProductEPI = [];
    // Test for updateProductEPI
    const updateProductEPIExecutionTime = [];
    const updateProductEPI = async () => {
        const sleepTime = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;
        // await sleep(sleepTime);
        let gtin;
        do {
            gtin = savedGTINs[Math.floor(Math.random() * savedGTINs.length)];
        } while (usedGTINsForProductEPI.includes(gtin));
        leafletDetails.payload.productCode = gtin;
        usedGTINsForProductEPI.push(gtin);
        const start = Date.now();
        await client.updateProductEPI(gtin, language, "leaflet", leafletDetails);
        const end = Date.now();
        updateProductEPIExecutionTime.push(end - start);
    }
    console.log('Testing updateProductEPI performance...');
    await measureApiPerformance(updateProductEPI, NO_LEAFLETS);
    console.log("Update Product EPI Execution Time", updateProductEPIExecutionTime);
    console.log('Average execution time for updateProductEPI:', updateProductEPIExecutionTime.reduce((a, b) => a + b) / updateProductEPIExecutionTime.length);

    const usedGTINsAndBatchNumbersForBatchEPI = [];
    const updateBatchEPIExecutionTime = [];
    const updateBatchEPI = async () => {
        const sleepTime = Math.floor(Math.random() * (10000 - 1000 + 1)) + 1000;
        // await sleep(sleepTime);
        let batchObject;
        do {
            batchObject = existingBatchObjects[Math.floor(Math.random() * existingBatchObjects.length)];
        } while (usedGTINsAndBatchNumbersForBatchEPI.includes(`${batchObject.batchNumber}_${batchObject.productCode}`));
        leafletDetails.payload.productCode = batchObject.productCode;
        leafletDetails.payload.batchNumber = batchObject.batchNumber;
        usedGTINsAndBatchNumbersForBatchEPI.push(`${batchObject.batchNumber}_${batchObject.productCode}`);
        const start = Date.now();
        await client.updateBatchEPI(batchObject.productCode, batchObject.batchNumber, language, "leaflet", leafletDetails);
        const end = Date.now();
        updateBatchEPIExecutionTime.push(end - start);
    }
    // Test for updateBatchEPI
    console.log('Testing updateBatchEPI performance...');
    await measureApiPerformance(updateBatchEPI, NO_LEAFLETS);
    console.log('Average execution time for updateBatchEPI:', updateBatchEPIExecutionTime.reduce((a, b) => a + b) / updateBatchEPIExecutionTime.length);
    callback();
}, 1000000);