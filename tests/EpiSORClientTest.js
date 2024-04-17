require("../../opendsu-sdk/builds/output/testsRuntime");
require('../../gtin-resolver/build/bundles/gtinResolver');

const dc = require("double-check");
const assert = dc.assert;
const EpiSORIntegrationClient = require("../lib/integrationAPIs/clients/EpiSORIntegrationClient");
const tir = require("../../opendsu-sdk/psknode/tests/util/tir");
const path = require("path");
const fs = require("fs");

assert.callback("EPISORClient Test Suite", async (callback) => {
    const domain = 'testDomain';
    const subdomain = 'testSubdomain';
    const client = EpiSORIntegrationClient.getInstance(domain, subdomain);
    const gtin = '02113111111164';
    const batchNumber = 'B123';
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
    const productDetails2 = {
        "messageType": "Product",
        "messageTypeVersion": 1,
        "senderId": "ManualUpload",
        "receiverId": "QPNVS",
        "messageId": "S000001",
        "messageDateTime": "2023-01-11T09:10:01CET",
        "payload": {
            "productCode": "00000000000000",
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

    const leafletDetails = require("./leaflet.json");
    const image = require("./image.json");

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
        "enableSimpleAuth": true
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

    const {port} = await tir.launchConfigurableApiHubTestNodeAsync({
        domains: [{name: domain, config: vaultDomainConfig}, {name: subdomain, config: vaultDomainConfig}],
        rootFolder: folder,
        serverConfig: serverConfig
    });

    const url = `http://localhost:${port}`;
    const apiKeysClient = apiKeyAPIs.getAPIKeysClient(url);
    const authorization = `Bearer user1:${crypto.sha256JOSE("password1").toString("hex")}`
    const headers = {
        "Authorization": authorization
    }
    const interceptor = (data, callback) => {
        let {url, headers} = data;

        if (!headers) {
            headers = {};
        }

        if (!headers.authorization) {
            headers.authorization = authorization;
        }
        callback(undefined, {url, headers});
    }
    http.registerInterceptor(interceptor);

    const apiKey = generateEncryptionKey();
    const body = {
        apiKey,
        secret: generateEncryptionKey()
    }
    await apiKeysClient.becomeSysAdmin(JSON.stringify(body), headers);
    await apiKeysClient.associateAPIKey("DSU_Fabric", "name", "usr1@example.com", {
        secret: generateEncryptionKey(),
        scope: "write"
    }, headers);

    const secretsService = await require("apihub").getSecretsServiceInstanceAsync(folder);
    const LightDBEnclaveFactory = require("../../gtin-resolver/lib/integrationAPIs/utils/LightDBEnclaveFactory");
    const lightDBEnclaveFactory = LightDBEnclaveFactory.getLightDBEnclaveFactoryInstance();
    const seedSSI = await $$.promisify(keySSISpace.createSeedSSI)(domain);
    await secretsService.putSecretInDefaultContainerAsync(lightDBEnclaveFactory.generateEnclaveName(domain, subdomain), seedSSI.base64Encode(seedSSI.getPrivateKey()))
    let error;
    try {
        await $$.promisify(client.addProduct)(gtin, productDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding product");

    error = undefined;
    try {
        await $$.promisify(client.addProduct)(productDetails2.payload.productCode, productDetails2);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding product");
    error = undefined;

    let products;
    try {
        products = await $$.promisify(client.listProducts)(0, 10, "__timestamp > 0", "asc");
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting products");
    assert.true(products.length === 2, "Products length is not the same");
    assert.true(products[0].productCode === productDetails.payload.productCode, "Product details are not the same");
    assert.true(products[1].productCode === productDetails2.payload.productCode, "Product details are not the same");
    error = undefined;
    let productMetadata;
    try {
        productMetadata = await $$.promisify(client.getProductMetadata)(gtin);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while updating product");
    assert.true(productMetadata.productCode === productDetails.payload.productCode, "Product details are not the same");

    error = undefined;
    try {
        await $$.promisify(client.updateProduct)(gtin, productDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while updating product");

    error = undefined;
    try {
        await $$.promisify(client.addBatch)(gtin, batchNumber, batchDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding batch");

    error = undefined;

    try {
        await $$.promisify(client.addBatch)(gtin, batchNumber, batchDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding batch");

    error = undefined;
    let batchMetadata;
    try {
        batchMetadata = await $$.promisify(client.getBatchMetadata)(gtin, batchNumber);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting batch metadata");
    assert.true(batchMetadata.batchNumber === batchDetails.payload.batchNumber, "Batch details are not the same");

    error = undefined;
    try {
        await $$.promisify(client.updateBatch)(gtin, batchNumber, batchDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while updating batch");

    error = undefined;
    let batches;
    try {
        batches = await $$.promisify(client.listBatches)(0, 10, "__timestamp > 0", "asc");
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting batches");
    assert.true(batches.length === 1, "Batches length is not the same");
    assert.true(batches[0].productCode === batchDetails.payload.productCode, "Batches details are not the same");

    error = undefined;
    try {
        await $$.promisify(client.addImage)(gtin, image);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding product image");

    let productPhoto;
    try {
        productPhoto = await $$.promisify(client.getImage)(gtin);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting product image");
    assert.true(productPhoto === image.payload.imageData, "Image details are not the same");

    error = undefined;
    try {
        await $$.promisify(client.updateImage)(gtin, image);
    } catch (e) {
        error = e;
    }

    assert.true(error === undefined, "Error while updating product image");

    productPhoto = undefined;
    try {
        productPhoto = await $$.promisify(client.getImage)(gtin);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting product image");
    assert.true(productPhoto === image.payload.imageData, "Image details are not the same");

    error = undefined;
    try {
        await $$.promisify(client.addProductEPI)(gtin, "en", "leaflet", leafletDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding EPI to product");

    error = undefined;
    let languages;
    try {
        languages = await $$.promisify(client.listProductLangs)(gtin, "leaflet");
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting languages");
    assert.true(languages.length === 1, "Leaflet not added properly on product");

    error = undefined;
    try {
        await $$.promisify(client.deleteProductEPI)(gtin, "en", "leaflet");
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while deleting EPI from product");

    //test epi add/update on batch
    leafletDetails.payload.batchNumber = batchNumber;
    error = undefined;
    try {
        await $$.promisify(client.addBatchEPI)(gtin, batchNumber, "en", "leaflet", leafletDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while adding EPI to batch");

    error = undefined;

    try {
        languages = await $$.promisify(client.listBatchLangs)(gtin, batchNumber, "leaflet");
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while getting languages");
    assert.true(languages.length === 1, "Leaflet not added properly on batch");

    delete leafletDetails.payload.batchNumber;
    error = undefined;
    try {
        await $$.promisify(client.updateProductEPI)(gtin, "en", "leaflet", leafletDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while updating EPI for product");


    leafletDetails.payload.batchNumber = batchNumber;
    error = undefined;
    try {
        await $$.promisify(client.updateBatchEPI)(gtin, batchNumber, "en", "leaflet", leafletDetails);
    } catch (e) {
        error = e;
    }
    assert.true(error === undefined, "Error while updating EPI for batch");

    error = undefined;
    let logs;
    try {
        logs = await $$.promisify(client.filterAuditLogs)("userAction", 0, 10, "__timestamp > 0", "asc");
    } catch (e) {
        error = e;
    }

    assert.true(error === undefined, "Error while getting audit logs");
    assert.true(logs.length === 10, "Logs length is not the same");

    callback();
}, 1000000);
