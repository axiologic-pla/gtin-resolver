const version = 1;
const {
    requestBodyJSONMiddleware,
    getIntegrationAPIsAuthorizationMiddleware,
    getRequestLimiterMiddleware
} = require("./utils/middlewares.js");
const LightDBEnclaveFactory = require("./utils/LightDBEnclaveFactory.js");
const {validateGTIN} = require("../utils/ValidationUtils.js");
const {migrateDataFromEpiEnclaveToLightDB, getMigrationStatus} = require("./utils/dataMigration.js");
const urlModule = require("url");

module.exports = function (server) {
    const lightDBEnclaveFactory = LightDBEnclaveFactory.getLightDBEnclaveFactoryInstance();
    const EPI_DOMAIN = process.env.EPI_DOMAIN;
    const EPI_SUBDOMAIN = process.env.EPI_SUBDOMAIN;
    //setting up the connection to lightDB and share to the services via lightDBEnclaveFactory apis
    //lightDBEnclaveFactory.setEnclaveInstance(domain);
    function basicPreValidationMiddleware(req, res, next) {
        const {gtin} = req.params;

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }
        //collecting and JSON parsing of payload
        let payload = req.body;

        if (!payload) {
            res.send(400);
            return;
        }

        //maybe a ${domain} validation is required to be sure that we know the domain or else to return 404 !

        next();
    }

    function addSendMethodMiddleware(req, res, next) {
        res.send = function send(statusCode, result) {
            res.setHeader('Server', 'SoR integration Middleware');
            res.statusCode = statusCode;
            res.end(result);
        }

        next();
    }

    function getDataFromRequest(req) {
        let {gtin, batchNumber, language} = req.params;
        let payload = req.body;
        if (batchNumber) {
            batchNumber = decodeURIComponent(batchNumber);
        }
        return {payload, gtin, batchNumber, language}
    }


    getRequestLimiterMiddleware(server);
    getIntegrationAPIsAuthorizationMiddleware(server);

    //this middleware injects the send method on res object before proceeding...
    server.use("/integration/*", addSendMethodMiddleware);

    const getDomainAndSubdomain = (req) => {
        const urlParts = urlModule.parse(req.url, true);
        let {domain, subdomain} = urlParts.query;
        domain = domain || EPI_DOMAIN;
        subdomain = subdomain || EPI_SUBDOMAIN;
        return {domain, subdomain};
    }

    server.use("/integration/*", async function (req, res, next) {
        const {domain, subdomain} = getDomainAndSubdomain(req);
        const enclaveInstance = await lightDBEnclaveFactory.createLightDBEnclaveAsync(domain, subdomain);
        const productController = require("./controllers/ProductController.js").getInstance(enclaveInstance, version);
        const batchController = require("./controllers/BatchController.js").getInstance(enclaveInstance, version);
        const leafletController = require("./controllers/LeafletController.js").getInstance(enclaveInstance, version);
        const monsterController = require("./controllers/MonsterController.js").getInstance(enclaveInstance, version);
        const auditService = require("./services/AuditService.js").getInstance(enclaveInstance);
        req.enclaveInstance = enclaveInstance;
        req.productController = productController;
        req.batchController = batchController;
        req.leafletController = leafletController;
        req.monsterController = monsterController;
        req.auditService = auditService;
        next();
    })

    //------ Product
    server.post("/integration/product/:gtin", requestBodyJSONMiddleware);
    // server.post("/integration/product/:gtin", basicPreValidationMiddleware);

    const createOrUpdateProductHandler = async function (req, res) {
        const {gtin} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);
        // get the domain and subdomain from query params
        //collecting and JSON parsing of productMessage
        let productMessage = req.body;

        try {
            productMessage = JSON.parse(productMessage);
        } catch (err) {
            //can we send errors to the client?!
            res.send(415, err.message);
            return;
        }

        try {
            if (productMessage.payload.strength && !productMessage.payload.strengths) {
                productMessage.payload.strengths = [{substance: "-", strength: productMessage.payload.strength}]
            }

            if (!productMessage.payload.description && productMessage.payload.nameMedicinalProduct) {
                productMessage.payload.description = productMessage.payload.nameMedicinalProduct;
            }
            if (!productMessage.payload.name && productMessage.payload.inventedName) {
                productMessage.payload.name = productMessage.payload.inventedName;
            }
            await req.productController.updateProduct(domain, subdomain, gtin, productMessage, req, res);
        } catch (err) {
            res.send(500, err.message);
        }
    }

    server.post("/integration/product/:gtin", createOrUpdateProductHandler);

    server.put("/integration/product/:gtin", requestBodyJSONMiddleware);
    server.put("/integration/product/:gtin", basicPreValidationMiddleware);
    server.put("/integration/product/:gtin", createOrUpdateProductHandler);

    server.get("/integration/product/:gtin", async function (req, res) {
        const {gtin} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        let productMetadata;
        try {
            productMetadata = await req.productController.getProduct(domain, subdomain, gtin, req, res);
            if (productMetadata.strength && !productMetadata.strengths) {
                productMetadata.strengths = [{substance: "-", strength: productMetadata.strength}]
            }
            if (productMetadata.description && !productMetadata.nameMedicinalProduct) {
                productMetadata.nameMedicinalProduct = productMetadata.description;
            }

            if (productMetadata.name && !productMetadata.inventedName) {
                productMetadata.inventedName = productMetadata.name;
            }
            res.setHeader("Content-type", "text/json");
            res.send(200, productMetadata);
        } catch (err) {
            res.send(500);
            return;
        }
    });

    const imageHandler = async function (req, res) {
        const {gtin} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);
        //collecting and JSON parsing of productPhotoMessage
        let productPhotoMessage = req.body;

        try {
            productPhotoMessage = JSON.parse(productPhotoMessage);
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        // let isValidImage = await isBase64ValidImage(productPhotoMessage.imageData)
        // if (!isValidImage) {
        //     res.send(415, "Unsupported file format");
        //     return;
        // }

        try {
            await req.productController.addImage(domain, subdomain, gtin, productPhotoMessage, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    }

    server.post("/integration/image/:gtin", requestBodyJSONMiddleware);
    server.post("/integration/image/:gtin", basicPreValidationMiddleware);
    server.post("/integration/image/:gtin", imageHandler);

    server.put("/integration/image/:gtin", requestBodyJSONMiddleware);
    server.put("/integration/image/:gtin", basicPreValidationMiddleware);
    server.put("/integration/image/:gtin", imageHandler);

    server.get("/integration/image/:gtin", async function (req, res) {
        const {gtin} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        let dsuVersion;
        if (req.query && req.query.version) {
            let valid = false;
            try {
                dsuVersion = Number(req.query.version);
                valid = Number.isInteger(dsuVersion);
            } catch (e) {
                res.send(422, JSON.stringify({
                    message: "Validation failed",
                    details: "Found version query param and is not a integer."
                }));
                return;
            }
            if (dsuVersion <= 0 || !valid) {
                res.send(422, JSON.stringify({
                    message: "Validation failed",
                    details: "Query version param need to be an integer greater then zero."
                }));
                return;
            }

            //because DSUVersion is read from an array that starts with index 0 and the versions from the audit start with 1, we need to do the version increment
            dsuVersion--;
        }

        try {
            await req.productController.getImage(domain, subdomain, gtin, dsuVersion, req, res);
        } catch (err) {
            res.send(500);
        }
    });

    //------ Batch
    const createOrUpdateBatchHandler = async function (req, res) {
        const {domain, subdomain} = getDomainAndSubdomain(req);

        let batchMessage, payload, gtin, batchNumber;
        try {
            const {payload: _payload, gtin: _gtin, batchNumber: _batchNumber} = getDataFromRequest(req);
            payload = _payload;
            gtin = _gtin;
            batchNumber = _batchNumber;
            batchMessage = JSON.parse(payload);
            if (batchMessage.payload.productCode !== gtin) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different gtin between url params and payload."
                }));
                return;
            }

            if (batchNumber !== batchMessage.payload.batchNumber) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different batch info between url params and payload."
                }));
                return;
            }
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            if (batchMessage.payload.batchNumber && !batchMessage.payload.batch) {
                batchMessage.payload.batch = batchMessage.payload.batchNumber;
            }
            await req.batchController.updateBatch(domain, subdomain, gtin, batchNumber, batchMessage, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    }
    server.put("/integration/batch/:gtin/:batchNumber", requestBodyJSONMiddleware);
    server.put("/integration/batch/:gtin/:batchNumber", basicPreValidationMiddleware);
    server.put("/integration/batch/:gtin/:batchNumber", createOrUpdateBatchHandler);

    server.post("/integration/batch/:gtin/:batchNumber", requestBodyJSONMiddleware);
    server.post("/integration/batch/:gtin/:batchNumber", basicPreValidationMiddleware);
    server.post("/integration/batch/:gtin/:batchNumber", createOrUpdateBatchHandler);
    server.get("/integration/batch/:gtin/:batchNumber", async function (req, res) {
        const {gtin, batchNumber} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        let batchMetadata;
        try {
            batchMetadata = await req.batchController.getBatch(domain, subdomain, gtin, decodeURIComponent(batchNumber), req, res);
            if (batchMetadata) {
                if (!batchMetadata.batchNumber && batchMetadata.batch) {
                    batchMetadata.batchNumber = batchMetadata.batch;
                }
                res.setHeader("Content-type", "text/json");
                res.send(200, batchMetadata);
            }
        } catch (err) {
            res.send(500);
            return;
        }
    });

    //------ Leaflet

    async function productEpiHandler(req, res) {
        const {epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //collecting and JSON parsing of leafletMessage
        let leafletMessage, gtin, payload, language;

        try {
            const {
                payload: _payload,
                gtin: _gtin,
                language: _language
            } = getDataFromRequest(req);
            payload = _payload;
            gtin = _gtin;
            language = _language;
            leafletMessage = JSON.parse(payload);
            if (leafletMessage.payload.productCode !== gtin || language !== leafletMessage.payload.language || leafletMessage.payload.batchNumber) {
                throw new Error("The data provided in the payload does not match the query parameters.");
            }

            if (leafletMessage.payload.productCode !== gtin) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different gtin code between payload and url param"
                }));
                return;
            }

            if (leafletMessage.payload.batchNumber) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Found batch info in payload, when it shouldn't"
                }));
                return;
            }

            if (language !== leafletMessage.payload.language) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different language code between payload and url param"
                }));
                return;
            }
        } catch (err) {
            res.send(415, err.message);
            return;
        }
        try {
            await req.leafletController.addEPI(domain, subdomain, gtin, null, language, epiType, leafletMessage, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    }

    async function batchEpiHandler(req, res) {
        const {epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //collecting and JSON parsing of leafletMessage
        let leafletMessage, gtin, batchNumber, payload, language;

        try {
            const {
                payload: _payload,
                gtin: _gtin,
                batchNumber: _batchNumber,
                language: _language
            } = getDataFromRequest(req);
            payload = _payload;
            gtin = _gtin;
            batchNumber = _batchNumber;
            language = _language;
            leafletMessage = JSON.parse(payload);
            if (leafletMessage.payload.productCode !== gtin) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different gtin code between payload and url param"
                }));
                return;
            }
            if (batchNumber !== leafletMessage.payload.batchNumber) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different batch info between payload and url param"
                }));
                return;
            }
            if (language !== leafletMessage.payload.language) {
                res.send(422, JSON.stringify({
                    message: "Payload validation failed",
                    details: "Different language code between payload and url param"
                }));
                return;
            }
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            await req.leafletController.addEPI(domain, subdomain, gtin, batchNumber, language, epiType, leafletMessage, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    }

    async function getEpiHandler(req, res) {
        let {gtin, batchNumber, language, epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);
        let dsuVersion;
        if (req.query && req.query.version) {
            let valid = false;
            try {
                dsuVersion = Number(req.query.version);
                valid = Number.isInteger(dsuVersion);
            } catch (e) {
                res.send(422, JSON.stringify({
                    message: "Validation failed",
                    details: "Found version query param and is not a integer."
                }));
                return;
            }
            if (dsuVersion <= 0 || !valid) {
                res.send(422, JSON.stringify({
                    message: "Validation failed",
                    details: "Query version param need to be an integer greater then zero."
                }));
                return;
            }

            //because DSUVersion is read from an array that starts with index 0 and the versions from the audit start with 1, we need to do the version increment
            dsuVersion--;
        }

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        const Languages = require("../utils/Languages.js");
        let langRegex = Languages.getLanguageRegex();
        if (!language || !langRegex.test(language)) {
            res.send(400);
            return;
        }

        if (["smpc", "leaflet"].indexOf(epiType) === -1) {
            res.send(400);
            return;
        }

        let EPI;
        try {
            if (batchNumber) {
                batchNumber = decodeURIComponent(batchNumber);
            }
            EPI = await req.leafletController.getEPI(domain, subdomain, gtin, batchNumber, language, epiType, dsuVersion, req, res);

            if (!EPI) {
                return res.send(404, `Not found EPI type ${epiType} for language ${language}`)
            }

            if (EPI.batchCode && !EPI.batchNumber) {
                EPI.batchNumber = EPI.batchCode;
            }
            if (!EPI.batchCode && EPI.batchNumber) {
                EPI.batchCode = EPI.batchNumber;
            }
        } catch (err) {
            return res.send(500);
        }

        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(EPI));
    }

    async function deleteProductEpiHandler(req, res) {
        const {gtin, language, epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        const Languages = require("../utils/Languages.js");
        let langRegex = Languages.getLanguageRegex();
        if (!language || !langRegex.test(language)) {
            res.send(400);
            return;
        }

        try {
            await req.leafletController.deleteEPI(domain, subdomain, gtin, undefined, language, epiType, req, res);
        } catch (err) {
            console.error(err);
            res.send(500);
            return;
        }
    }

    async function deleteBatchEpiHandler(req, res) {
        const {gtin, batchNumber, language, epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        const Languages = require("../utils/Languages.js");
        let langRegex = Languages.getLanguageRegex();
        if (!language || !langRegex.test(language)) {
            res.send(400);
            return;
        }

        try {
            await req.leafletController.deleteEPI(domain, subdomain, gtin, decodeURIComponent(batchNumber), language, epiType, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    }

    server.put("/integration/epi/:gtin/:language/:epiType", requestBodyJSONMiddleware);
    server.put("/integration/epi/:gtin/:language/:epiType", basicPreValidationMiddleware);
    server.put("/integration/epi/:gtin/:language/:epiType", productEpiHandler);

    server.put("/integration/epi/:gtin/:batchNumber/:language/:epiType", requestBodyJSONMiddleware);
    server.put("/integration/epi/:gtin/:batchNumber/:language/:epiType", basicPreValidationMiddleware);
    server.put("/integration/epi/:gtin/:batchNumber/:language/:epiType", batchEpiHandler);

    server.post("/integration/epi/:gtin/:language/:epiType", requestBodyJSONMiddleware);
    server.post("/integration/epi/:gtin/:language/:epiType", basicPreValidationMiddleware);
    server.post("/integration/epi/:gtin/:language/:epiType", productEpiHandler);

    server.post("/integration/epi/:gtin/:batchNumber/:language/:epiType", requestBodyJSONMiddleware);
    server.post("/integration/epi/:gtin/:batchNumber/:language/:epiType", basicPreValidationMiddleware);
    server.post("/integration/epi/:gtin/:batchNumber/:language/:epiType", batchEpiHandler);

    server.get("/integration/epi/:gtin/:language/:epiType", getEpiHandler);
    server.get("/integration/epi/:gtin/:batchNumber/:language/:epiType", getEpiHandler);


//    server.delete("/integration/epi/:gtin/:language/:epiType", requestBodyJSONMiddleware);
//    server.delete("/integration/epi/:gtin/:language/:epiType", basicPreValidationMiddleware);
    server.delete("/integration/epi/:gtin/:language/:epiType", deleteProductEpiHandler);

//    server.delete("/integration/epi/:gtin/:batchNumber/:language/:epiType", requestBodyJSONMiddleware);
//    server.delete("/integration/epi/:gtin/:batchNumber/:language/:epiType", basicPreValidationMiddleware);
    server.delete("/integration/epi/:gtin/:batchNumber/:language/:epiType", deleteBatchEpiHandler);

    //------ Messages
    server.put("/integration/message", requestBodyJSONMiddleware);
    server.put("/integration/message", async function (req, res) {
        let message = req.body;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        try {
            message = JSON.parse(message);
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            await req.monsterController.digestMessage(domain, subdomain, message, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    });

    server.put("/integration/multipleMessages", requestBodyJSONMiddleware);
    server.put("/integration/multipleMessages", async function (req, res) {
        let message = req.body;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        try {
            message = JSON.parse(message);
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            await req.monsterController.digestMultipleMessages(domain, subdomain, message, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    });


    server.get("/integration/listProducts", async (req, res) => {
        const urlModule = require('url');
        const urlParts = urlModule.parse(req.url, true);
        const {query, start, sort, number} = urlParts.query;
        let products;
        try {
            products = await req.productController.listProducts(parseInt(start), parseInt(number), stringToArray(query), sort, req, res);
        } catch (e) {
            return res.send(500);
        }
        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(products));
    })

    function stringToArray(string) {
        let splitString = string.split(",");
        let arr = [];
        splitString.forEach((query) => {
            arr.push(query);
        });
        return arr;
    }

    server.get("/integration/listBatches", async (req, res) => {
        const urlModule = require('url');
        const urlParts = urlModule.parse(req.url, true);
        const {query, start, sort, number} = urlParts.query;
        let batches;
        try {
            batches = await req.batchController.listBatches(parseInt(start), parseInt(number), stringToArray(query), sort, req, res);
        } catch (e) {
            return res.send(500);
        }
        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(batches));
    })

    server.get("/integration/listProductLangs/:gtin/:epiType", async (req, res) => {
        const {gtin, epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        let languages;
        try {
            languages = await req.productController.listLanguages(domain, subdomain, gtin, epiType, req, res);
        } catch (e) {
            return res.send(500);
        }
        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(languages));
    })

    server.get("/integration/listBatchLangs/:gtin/:batchNumber/:epiType", async (req, res) => {
        const {gtin, batchNumber, epiType} = req.params;
        const {domain, subdomain} = getDomainAndSubdomain(req);

        let languages;
        try {
            languages = await req.batchController.listLanguages(domain, subdomain, gtin, decodeURIComponent(batchNumber), epiType, req, res);
        } catch (e) {
            return res.send(500);
        }
        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(languages));
    });

    server.get("/integration/audit/:logType", async (req, res) => {
        const urlModule = require('url');
        const urlParts = urlModule.parse(req.url, true);
        const {logType} = req.params;
        const {query, start, sort, number} = urlParts.query;

        let logs;
        try {
            logs = await req.auditService.filterAuditLogs(logType, parseInt(start), parseInt(number), stringToArray(query), sort);
        } catch (e) {
            return res.send(500);
        }

        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify(logs));
    });

    server.post("/integration/audit/:logType", requestBodyJSONMiddleware);
    server.post("/integration/audit/:logType", async (req, res) => {
        const {logType} = req.params;
        let auditMessage = req.body;

        try {
            auditMessage = JSON.parse(auditMessage);
        } catch (err) {
            //can we send errors to the client?!
            res.send(415, err.message);
            return;
        }
        try {
            await req.auditService.addLog(logType, auditMessage, req, res);
        } catch (err) {
            res.send(500, "Failed to audit user access");
            return;
        }
        res.setHeader("Content-type", "text/json");
        res.send(200, JSON.stringify({logType: "saved"}));
    });

    // PUT /integration/{domain}/productGroupedMessages/{gtin}
    server.put("/integration/productGroupedMessages/:gtin", requestBodyJSONMiddleware);
    server.put("/integration/productGroupedMessages/:gtin", async function (req, res) {
        let messages = req.body;
        let {gtin} = req.params;

        try {
            messages = JSON.parse(messages);
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            await req.monsterController.digestProductGroupedMessages(gtin, messages, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    });

    server.put("/integration/batchGroupedMessages/:gtin/:batchNumber", requestBodyJSONMiddleware);
    server.put("/integration/batchGroupedMessages/:gtin/:batchNumber", async function (req, res) {
        let messages = req.body;
        let {gtin, batchNumber} = req.params;

        try {
            messages = JSON.parse(messages);
        } catch (err) {
            res.send(415, err.message);
            return;
        }

        try {
            await req.monsterController.digestBatchGroupedMessages(gtin, decodeURIComponent(batchNumber), messages, req, res);
        } catch (err) {
            res.send(500);
            return;
        }
    });

    async function objectStatusHandler(req, res) {
        let {gtin, batchNumber} = req.params;

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        let controller;
        const {domain, subdomain} = getDomainAndSubdomain(req);
        let args = [domain, subdomain, gtin];
        if (!batchNumber) {
            controller = req.productController;
        } else {
            controller = req.batchController;
            args.push(decodeURIComponent(batchNumber));
        }
        args.push(version);

        let status;
        try {
            status = await controller.checkObjectStatus(...args);
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end();
            return;
        }

        res.statusCode = 200;
        res.setHeader("Content-type", "text/plain");
        res.setHeader("Content-length", status.length);
        res.end(status);
    }

    server.get("/integration/objectStatus/:gtin", objectStatusHandler)
    server.get("/integration/objectStatus/:gtin/:batchNumber", objectStatusHandler);

    async function recoverObjectHandler(req, res) {
        let {gtin, batchNumber} = req.params;

        //gtin validation required...
        let {isValid} = validateGTIN(gtin);
        if (!isValid) {
            res.send(400);
            return;
        }

        let controller;
        const {domain, subdomain} = getDomainAndSubdomain(req);
        let args = [domain, subdomain, gtin];
        if (!batchNumber) {
            controller = req.productController;
        } else {
            controller = req.batchController;
            args.push(decodeURIComponent(batchNumber));
        }
        //args.push(version);

        try {
            await controller.recover(...args, req, res);
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end();
            return;
        }

        //at this point in time a result should have been sent to client
    }

    server.post("/integration/recoverProduct/:gtin", recoverObjectHandler)
    server.post("/integration/recoverBatch/:gtin/:batchNumber", recoverObjectHandler);

    server.put("/doMigration", requestBodyJSONMiddleware);
    server.put("/doMigration", async (req, res) => {
        let body;
        try {
            body = JSON.parse(req.body);
        } catch (err) {
            res.send(415, err.message);
            return;
        }
        let {epiEnclaveKeySSI} = body;
        try {
            await migrateDataFromEpiEnclaveToLightDB(EPI_DOMAIN, EPI_SUBDOMAIN, epiEnclaveKeySSI);
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end();
            return;
        }
        res.end();
    });

    server.get("/getMigrationStatus", async (req, res) => {
        let migrationStatus;
        try {
            migrationStatus = await getMigrationStatus();
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end();
            return;
        }
        res.statusCode = 200;
        res.end(migrationStatus);
    })
}
